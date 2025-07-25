# DWC Bot

Telegram bot allowing users to report scammers and lookup usernames. The bot will validate user membership in a specific channel, submit reports to a review group, and publish accepted reports to a main public channel.

---

## Prerequisites

- **Node.js** (v18 or later)
- **Python 3** (for Telegram ID resolver)

---

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
pip install -r requirements.txt
```

### 2. Configure the Bot

Copy the example config and edit it:

```bash
cp .env.example .env
```

Edit `.env` and fillout everything:

```env
# Get your bot token from @BotFather
TELEGRAM_TOKEN=your_bot_token_here

# Set your review group ID; bot must be added to this group chat
# Use /id command in the group to get the ID
REVIEW_GROUP_ID=GROUP_ID

# Set your main channel @username where the bot will post messages
# Bot must be an admin in this channel
MAIN_CHANNEL_ID=@your_main_channel

# Set your required membership channel @username where users must be members to use the bot
# Bot must be an admin in this channel
REQUIRED_MEMBERSHIP_CHANNEL=@your_required_channel

# Set your Telegram user ID for admin commands
# Find your user ID using @userinfobot in Telegram
ADMIN_ID=your_telegram_user_id

# Needed for username to ID conversion (MTProto API credentials)
# Get these from https://my.telegram.org/apps
API_ID=your_api_id
API_HASH=your_api_hash
```

---

## Database

The bot uses SQLite and will create `scam_reports.db` automatically with the required tables.

---

## Telegram Username to ID Resolver

Some Telegram usernames cannot be resolved to user IDs via the Bot API.  
This bot uses a Python script (`utils/get_telegram_id.py`) as a fallback.

**First-time setup:**

1. Run the resolver once to initialize the session:

   ```bash
   python utils/get_telegram_id.py <any_username>
   ```

   - You will be prompted for your phone number and login code.
   - This creates `session.txt` for future automatic lookups.

**Note:**  

- The bot will use this script automatically if it cannot resolve a username via the Bot API.

---

## Usage

Start the bot:

```bash
npm start
```

### Main Features

- `/start` - Begin report flow.
- `/lookup <username>` - Lookup scam reports by username.
- `/export` - Export all reports to CSV (admin only).
- `/blacklist <user_id> [reason]` - Blacklist a user from reporting (admin only).

Reports are reviewed in the review group and published to the main channel if accepted.  
Scammer usernames are resolved to Telegram IDs for reliable linking.

---

### 📝 Report Submission Flow

#### Step 1: Verify Channel Membership

- Users must be a member of a configured channel to submit a report.
- Channel ID should be stored in a `.env` config.

#### Step 2: Report Form

Collect the following fields from the user:

- Telegram username or ID of the scammer
- Amount lost
- Detailed description of the scam
- Link to a Telegram channel/message containing proof (e.g. screenshot, message log)

#### Step 3: Review

- Submit the collected report to a **review group chat** (configurable via `src\configs\config.ts`)
- Mod team can either:

  - ✅ Accept the report → Automatically post to the **main public channel**
  - ❌ Deny the report → Notify the user it was declined, optionally with a reason

#### Step 4: Logging

- If accepted, store report details and any proof links in a **SQLite database**
