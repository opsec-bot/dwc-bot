import dotenv from 'dotenv';
dotenv.config();

export const config = {
  telegramToken: process.env.TELEGRAM_TOKEN || '',
  reviewGroupId: process.env.REVIEW_GROUP_ID || '', // group chat for review
  mainChannelId: process.env.MAIN_CHANNEL_ID || '', // public channel for accepted reports
  requiredMembershipChannel: process.env.REQUIRED_MEMBERSHIP_CHANNEL || '', // channel users must join
  expressPort: process.env.EXPRESS_PORT || '80',
  adminId: process.env.ADMIN_ID ? parseInt(process.env.ADMIN_ID, 10) : 0,
};
