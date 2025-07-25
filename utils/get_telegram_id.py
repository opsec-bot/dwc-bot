from telethon.sync import TelegramClient
from telethon.sessions import StringSession
import os
import sys
from dotenv import load_dotenv

load_dotenv()
api_id = int(os.getenv('API_ID'))
api_hash = os.getenv('API_HASH')

if len(sys.argv) < 2:
    print("Usage: python get_telegram_id.py <username>")
    sys.exit(1)

username = sys.argv[1].lstrip('@')

session_path = os.path.join(os.path.dirname(__file__), 'session.txt')
if not os.path.exists(session_path):
    open(session_path, 'a').close()

# Use StringSession for portability, save/load session string from session.txt
def load_session():
    try:
        with open(session_path, 'r') as f:
            s = f.read().strip()
            return StringSession(s) if s else StringSession()
    except Exception:
        return StringSession()

def save_session(session_string):
    with open(session_path, 'w') as f:
        f.write(session_string)

session = load_session()

with TelegramClient(session, api_id, api_hash) as client:
    try:
        client.start()
        user = client.get_entity(username)
        print(user.id)
        # Save session string after successful run
        save_session(client.session.save())
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(2)
