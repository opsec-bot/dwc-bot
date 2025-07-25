// index.ts
import path from 'path';
import fs from 'fs';
import TelegramBot from 'node-telegram-bot-api';
import { spawnSync } from 'child_process';

// Configurations and Messages
import { config } from './configs/config';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { z } from 'zod';

// --- DB SETUP ---
const dbPromise = open({
  filename: path.join(__dirname, 'scam_reports.db'),
  driver: sqlite3.Database,
});
(async () => {
  const db = await dbPromise;
  await db.run(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_id INTEGER,
      scammer TEXT,
      scammer_id INTEGER, -- NEW: scammer's Telegram user ID
      amount TEXT,
      description TEXT,
      proof_link TEXT,
      status TEXT,
      review_message_id INTEGER,
      user_message_id INTEGER,
      review_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS blacklist (
      user_id INTEGER PRIMARY KEY,
      reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
})();

// -----------------------------------------------------------------------------
// INITIALIZATION
// -----------------------------------------------------------------------------

process.env.NTBA_FIX_350 = 'true';
export const bot = new TelegramBot(config.telegramToken, { polling: true });

const BANNER = `
██████  ██     ██  ██████       ██████   ██████  ████████ 
██   ██ ██     ██ ██            ██   ██ ██    ██    ██    
██   ██ ██  █  ██ ██      █████ ██████  ██    ██    ██    
██   ██ ██ ███ ██ ██            ██   ██ ██    ██    ██    
██████   ███ ███   ██████       ██████   ██████     ██    
                            by t.me/credit200                                                        
`;
console.log(`\x1b[34m${BANNER}\x1b[0m`);

// --- UTILS ---
async function isMember(userId: number): Promise<boolean> {
  try {
    const res = await bot.getChatMember(config.requiredMembershipChannel, userId);
    return ['member', 'administrator', 'creator'].includes(res.status);
  } catch {
    return false;
  }
}

async function sendReportToReviewGroup(report: any, reportId: number) {
  const text = `🚨 *New Scam Report*\n\n*Scammer:* ${report.scammer}\n*Amount Lost:* ${report.amount}\n*Description:*\n${report.description}\n*Proof:* ${report.proof_link}\n\nReporter: [${report.reporter_id}](tg://user?id=${report.reporter_id})`;
  const opts = {
    parse_mode: 'Markdown' as const,
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Accept', callback_data: `accept_${reportId}` },
          { text: '❌ Deny', callback_data: `deny_${reportId}` },
          { text: '🚫 Blacklist', callback_data: `blacklist_${reportId}` }, // Added Blacklist button
        ],
      ],
    },
  };
  const msg = await bot.sendMessage(config.reviewGroupId, text, opts);
  return msg.message_id;
}

async function postToMainChannel(report: any) {
  // Ensure scammer starts with @
  let scammerUsername = report.scammer.startsWith('@') ? report.scammer : `@${report.scammer}`;
  let scammerLink: string;
  if (report.scammer_id) {
    scammerLink = `[${scammerUsername}](tg://user?id=${report.scammer_id})`;
  } else {
    scammerLink = `[${scammerUsername}](https://t.me/${scammerUsername.replace(/^@/, '')})`;
  }
  const text = `⚠️ *Scammer Alert!*\n\n*Scammer:* ${scammerLink}\n*Amount Lost:* ${report.amount}\n*Description:*\n${report.description}\n*Proof:* ${report.proof_link}`;
  await bot.sendMessage(config.mainChannelId, text, { parse_mode: 'Markdown' });
}

// --- STATE ---
const userStates = new Map<number, { step: number; data: any }>();

// --- EXPORT & USER COUNT HELPERS ---

/**
 * Exports all reports to a CSV file in the current directory.
 * Returns { status: 'success', file: string } or { status: 'error', error: string }
 */
async function exportDB(): Promise<
  { status: 'success'; file: string } | { status: 'error'; error: string }
> {
  try {
    const db = await dbPromise;
    const rows = await db.all('SELECT * FROM reports');
    if (!rows.length) {
      return { status: 'error', error: 'No data to export.' };
    }
    const csvHeader = Object.keys(rows[0]).join(',') + '\n';
    const csvRows = rows
      .map((row) =>
        Object.values(row)
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(',')
      )
      .join('\n');
    const csvContent = csvHeader + csvRows;
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
    const csvFileName = `export_${timestamp}.csv`;
    const csvFilePath = path.resolve(__dirname, csvFileName);
    fs.writeFileSync(csvFilePath, csvContent, 'utf8');
    return { status: 'success', file: csvFilePath };
  } catch (error: any) {
    return { status: 'error', error: error.message || String(error) };
  }
}

/**
 * Returns the total number of unique users who have submitted reports.
 */
async function getUserCount(): Promise<number> {
  const db = await dbPromise;
  const row = await db.get('SELECT COUNT(DISTINCT reporter_id) as count FROM reports');
  return row?.count ?? 0;
}

// --- BLACKLIST UTILS ---
async function isBlacklisted(userId: number): Promise<{ blacklisted: boolean; reason?: string }> {
  const db = await dbPromise;
  const row = await db.get('SELECT * FROM blacklist WHERE user_id = ?', userId);
  return row ? { blacklisted: true, reason: row.reason } : { blacklisted: false };
}

async function addToBlacklist(userId: number, reason?: string) {
  const db = await dbPromise;
  await db.run(
    'INSERT OR REPLACE INTO blacklist (user_id, reason) VALUES (?, ?)',
    userId,
    reason || ''
  );
}

// -----------------------------------------------------------------------------
// BOT COMMANDS AND EVENT REGISTRATION
// -----------------------------------------------------------------------------

bot.setMyCommands([
  { command: 'start', description: 'Start the bot' },
  { command: 'id', description: 'Retrieve the current channel ID' },
  { command: 'export', description: 'Export the database to CSV (Admin)' },
  { command: 'lookup', description: 'Lookup scam reports by username' },
  { command: 'blacklist', description: 'Blacklist a user from reporting (Admin)' },
]);

// Text commands
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const opts = {
    reply_markup: {
      inline_keyboard: [[{ text: 'Create Report', callback_data: 'create_report' }]],
    },
  };
  await bot.sendMessage(
    chatId,
    'Hello, click the button below to create a report. If you want to lookup a user, use the command /lookup',
    opts
  );
});

bot.onText(/\/id/, (msg) => {
  bot.sendMessage(msg.chat.id, `Channel ID: \`${msg.chat.id}\``, { parse_mode: 'Markdown' });
});

// You can leave your /export command here or move it to its own module if desired.
bot.onText(/\/export/, async (msg) => {
  const chatId = msg.chat.id;
  if (msg.from?.id !== config.adminId) {
    return;
  }

  try {
    const startTime = process.hrtime();
    const exportResult = await exportDB();
    if (exportResult.status === 'success') {
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
      const csvFileName = `export_${timestamp}.csv`;
      const csvFilePath = exportResult.file;
      const userCount = await getUserCount();
      const fileOptions = { filename: csvFileName, contentType: 'text/csv' };
      const [seconds, nanoseconds] = process.hrtime(startTime);
      const duration = (seconds * 1000 + nanoseconds / 1e6).toFixed(2);

      await bot.sendDocument(
        chatId,
        csvFilePath,
        {
          caption: `Total Users: ${userCount}\nTime taken to export: ${duration} ms`,
          parse_mode: 'Markdown',
        },
        fileOptions
      );
      fs.unlink(csvFilePath, (err) => err && console.error('Error deleting CSV:', err));
    } else {
      await bot.sendMessage(chatId, `Failed to export CSV: ${exportResult.error}`);
    }
  } catch (error) {
    console.error('Error during export:', error);
    await bot.sendMessage(chatId, 'An error occurred while exporting the CSV.');
  }
});

// Lookup command
bot.onText(/\/lookup (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const username = match?.[1]?.trim();
  if (!username) {
    await bot.sendMessage(chatId, 'Please provide a username to lookup.');
    return;
  }
  const db = await dbPromise;
  const reports = await db.all(
    "SELECT * FROM reports WHERE scammer LIKE ? AND status = 'accepted'",
    [`%${username}%`]
  );
  if (reports.length === 0) {
    await bot.sendMessage(chatId, 'No reports found for this user.');
  } else {
    for (const r of reports) {
      await bot.sendMessage(
        chatId,
        `*Scammer:* ${r.scammer}\n*Amount Lost:* ${r.amount}\n*Description:*\n${r.description}\n*Proof:* ${r.proof_link}`,
        { parse_mode: 'Markdown' }
      );
    }
  }
});

// Blacklist command (admin only)
bot.onText(/\/blacklist (\d+)(?: (.*))?/, async (msg, match) => {
  if (msg.from?.id !== config.adminId) {
    return;
  }
  const userId = parseInt(match?.[1] || '', 10);
  const reason = match?.[2] || '';
  if (!userId) {
    await bot.sendMessage(msg.chat.id, 'Usage: /blacklist <user_id> [reason]');
    return;
  }
  await addToBlacklist(userId, reason);
  await bot.sendMessage(
    msg.chat.id,
    `User ${userId} has been blacklisted.${reason ? ` Reason: ${reason}` : ''}`
  );
  try {
    await bot.sendMessage(
      userId,
      `🚫 You have been blacklisted from reporting.${reason ? `\nReason: ${reason}` : ''}`
    );
  } catch {}
});

// Helper to resolve Telegram user ID using Python script as fallback
async function resolveTelegramId(username: string): Promise<number | undefined> {
  // Try node-telegram-bot-api first
  try {
    const user = await bot.getChat(`@${username}`);
    if (user && user.id) return user.id;
  } catch {}
  // Fallback to Python script
  try {
    const pyPath = path.join(__dirname, '..', 'utils', 'get_telegram_id.py');
    const result = spawnSync('python', [pyPath, username], { encoding: 'utf8' });
    if (result.status === 0) {
      const id = parseInt(result.stdout.trim(), 10);
      if (!isNaN(id)) return id;
    }
  } catch {}
  return undefined;
}

// Global callback query handler
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.from.id;
  const callback = callbackQuery.data;
  if (!callback) return;

  if (callback === 'create_report') {
    // Check membership
    if (!(await isMember(chatId))) {
      await bot.sendMessage(chatId, 'You must join the required channel to submit a report.');
      return;
    }
    // Check blacklist
    const bl = await isBlacklisted(chatId);
    if (bl.blacklisted) {
      await bot.sendMessage(
        chatId,
        `🚫 You have been blacklisted from reporting.${bl.reason ? `\nReason: ${bl.reason}` : ''}`
      );
      return;
    }
    userStates.set(chatId, { step: 1, data: {} });
    await bot.sendMessage(chatId, 'Enter the Telegram username of the scammer:');
    return;
  } else if (
    callback.startsWith('accept_') ||
    callback.startsWith('deny_') ||
    callback.startsWith('blacklist_')
  ) {
    const [action, reportIdStr] = callback.split('_');
    const reportId = parseInt(reportIdStr, 10);
    const db = await dbPromise;
    const report = await db.get('SELECT * FROM reports WHERE id = ?', reportId);
    if (!report) return;

    const adminId = callbackQuery.from.id;

    if (action === 'accept') {
      await db.run("UPDATE reports SET status = 'accepted' WHERE id = ?", reportId);
      await postToMainChannel(report);
      await bot.sendMessage(
        config.reviewGroupId,
        `✅ Report #${reportId} accepted by [${adminId}](tg://user?id=${adminId})`,
        { parse_mode: 'Markdown' }
      );
      if (report.reporter_id) {
        await bot.sendMessage(
          report.reporter_id,
          `✅ Your report has been accepted and published. Thank you for helping the community!`
        );
      }
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: config.reviewGroupId, message_id: report.review_message_id }
      );
    } else if (action === 'deny') {
      await db.run("UPDATE reports SET status = 'denied' WHERE id = ?", reportId);
      await bot.sendMessage(
        config.reviewGroupId,
        `❌ Report #${reportId} denied by [${adminId}](tg://user?id=${adminId})`,
        { parse_mode: 'Markdown' }
      );
      if (report.reporter_id) {
        await bot.sendMessage(report.reporter_id, `❌ Your report was denied by the moderators.`);
      }
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: config.reviewGroupId, message_id: report.review_message_id }
      );
    } else if (action === 'blacklist') {
      await db.run(
        'INSERT OR REPLACE INTO blacklist (user_id, reason) VALUES (?, ?)',
        report.reporter_id,
        ''
      );
      await bot.sendMessage(
        config.reviewGroupId,
        `🚫 User [${report.reporter_id}](tg://user?id=${report.reporter_id}) has been blacklisted by [${adminId}](tg://user?id=${adminId})`,
        { parse_mode: 'Markdown' }
      );
      if (report.reporter_id) {
        await bot.sendMessage(report.reporter_id, `🚫 You have been blacklisted from reporting.`);
      }
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: config.reviewGroupId, message_id: report.review_message_id }
      );
    }
    return;
  }
});

// --- ZOD SCHEMA FOR REPORT VALIDATION ---
// Telegram username regex: 5-32 chars, letters/numbers/underscores, no spaces, no special chars, cannot start/end with _ or number, no double underscores
const telegramUsernameRegex = /^(?!_)(?!.*__)(?!.*_$)(?![0-9])[A-Za-z][A-Za-z0-9_]{4,31}(?<!_)$/;

const reportSchema = z.object({
  scammer: z.string().regex(telegramUsernameRegex, 'Invalid Telegram username format'),
  scammer_id: z.number().optional(), // NEW: allow undefined if not found
  amount: z.string().min(1).max(32),
  description: z.string().min(5).max(2048),
  proof_link: z.string().url().or(z.string().min(5).max(512)), // Accepts URL or a string (for Telegram message links)
  reporter_id: z.number(),
});

// --- REPORT FORM FLOW ---
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const chatId = msg.chat.id;
  const state = userStates.get(chatId);
  if (!state) return;

  // Step 1: Get scammer username
  if (state.step === 1) {
    const scammer = msg.text.trim();
    const scammerCheck = z.string().regex(telegramUsernameRegex, 'Invalid Telegram username format').safeParse(scammer);
    if (!scammerCheck.success) {
      await bot.sendMessage(
        chatId,
        'Invalid Telegram username.'
      );
      return;
    }
    state.data.scammer = scammer;

    // Try to resolve Telegram user ID (Node.js first, then Python fallback)
    let scammer_id: number | undefined = undefined;
    try {
      const username = scammer.replace(/^@/, '');
      scammer_id = await resolveTelegramId(username);
    } catch {}
    state.data.scammer_id = scammer_id;

    state.step = 2;
    await bot.sendMessage(chatId, 'Enter the amount lost (e.g. $100):');
    return;
  }
  if (state.step === 2) {
    // Validate amount field
    const amount = msg.text.trim();
    const amountCheck = z.string().min(1).max(32).safeParse(amount);
    if (!amountCheck.success) {
      await bot.sendMessage(chatId, 'Invalid amount. Please try again.');
      return;
    }
    state.data.amount = amount;
    state.step = 3;
    await bot.sendMessage(chatId, 'Describe the scam in detail:');
    return;
  }
  if (state.step === 3) {
    // Validate description field
    const description = msg.text.trim();
    const descriptionCheck = z.string().min(5).max(2048).safeParse(description);
    if (!descriptionCheck.success) {
      await bot.sendMessage(chatId, 'Description too short or too long. Please try again.');
      return;
    }
    state.data.description = description;
    state.step = 4;
    await bot.sendMessage(
      chatId,
      'Paste a link to a Telegram message or channel containing proof (e.g. screenshot, message log):'
    );
    return;
  }
  if (state.step === 4) {
    // Validate proof_link field
    const proof_link = msg.text.trim();
    const proofCheck = z.string().min(5).max(512).safeParse(proof_link);
    if (!proofCheck.success) {
      await bot.sendMessage(chatId, 'Invalid proof link. Please try again.');
      return;
    }
    state.data.proof_link = proof_link;

    // Validate the whole report before saving
    const reportData = {
      ...state.data,
      reporter_id: chatId,
    };
    const validation = reportSchema.safeParse(reportData);
    if (!validation.success) {
      await bot.sendMessage(
        chatId,
        'Your report contains invalid data. Please restart with /start.'
      );
      userStates.delete(chatId);
      return;
    }

    // Save to DB as pending (include scammer_id)
    const db = await dbPromise;
    const res = await db.run(
      "INSERT INTO reports (reporter_id, scammer, scammer_id, amount, description, proof_link, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')",
      chatId,
      state.data.scammer,
      state.data.scammer_id ?? null,
      state.data.amount,
      state.data.description,
      state.data.proof_link
    );
    const reportId: number = res.lastID as number;
    const reviewMsgId = await sendReportToReviewGroup(
      { ...state.data, reporter_id: chatId },
      reportId
    );
    await db.run('UPDATE reports SET review_message_id = ? WHERE id = ?', reviewMsgId, reportId);
    await bot.sendMessage(
      chatId,
      'Your report has been submitted for review. You will be notified once it is processed.'
    );
    userStates.delete(chatId);
    return;
  }
});

// Polling error handler
bot.on('polling_error', (error: Error) => {
  console.error('Polling error:', error);
});
