"""
Encrypted SQLite Backup Utility (LGPD & Data Security Compliance)
Creates a password-encrypted dump of studio_bot.db using PBKDF2-HMAC-SHA256 + Fernet (AES-128-CBC + HMAC-SHA256).
"""

import os
import sys
import time
import base64
import sqlite3
from datetime import datetime
from typing import Optional

from dotenv import load_dotenv
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB_PATH = os.path.join(BASE_DIR, "studio_bot.db")
BACKUPS_DIR = os.path.join(BASE_DIR, "backups")


def _derive_fernet_key(password: str, salt: bytes) -> bytes:
    """Derives a 32-byte URL-safe base64 key from a password and 16-byte salt using PBKDF2-HMAC-SHA256."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=480000,
    )
    return base64.urlsafe_b64encode(kdf.derive(password.encode("utf-8")))


def create_encrypted_backup(
    password: Optional[str] = None,
    db_path: str = DEFAULT_DB_PATH,
    output_path: Optional[str] = None
) -> str:
    """
    Dumps the SQLite database to SQL text and encrypts it with a password using PBKDF2 + Fernet.
    File format: 16-byte random salt + Fernet token bytes.
    Returns the path to the encrypted backup file.
    """
    pwd = password or os.environ.get("BACKUP_PASSWORD") or os.environ.get("SECRET_KEY") or "StudioBackupKey2026!"
    os.makedirs(BACKUPS_DIR, exist_ok=True)

    if not output_path:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_path = os.path.join(BACKUPS_DIR, f"studio_bot_backup_{ts}.db.enc")

    if not os.path.exists(db_path):
        raise FileNotFoundError(f"Database file not found: {db_path}")

    conn = sqlite3.connect(db_path)
    try:
        sql_dump = "\n".join(conn.iterdump())
    finally:
        conn.close()

    salt = os.urandom(16)
    key = _derive_fernet_key(pwd, salt)
    cipher = Fernet(key)
    encrypted_payload = cipher.encrypt(sql_dump.encode("utf-8"))

    with open(output_path, "wb") as f:
        f.write(salt + encrypted_payload)

    return output_path


def decrypt_backup(encrypted_path: str, password: Optional[str] = None) -> str:
    """
    Decrypts an encrypted backup file created by create_encrypted_backup() and returns the SQL dump string.
    Raises cryptography.fernet.InvalidToken if the password is wrong.
    """
    pwd = password or os.environ.get("BACKUP_PASSWORD") or os.environ.get("SECRET_KEY") or "StudioBackupKey2026!"
    with open(encrypted_path, "rb") as f:
        raw = f.read()

    if len(raw) <= 16:
        raise ValueError("Invalid encrypted backup file.")

    salt = raw[:16]
    token = raw[16:]
    key = _derive_fernet_key(pwd, salt)
    cipher = Fernet(key)
    decrypted_bytes = cipher.decrypt(token)
    return decrypted_bytes.decode("utf-8")


if __name__ == "__main__":
    pwd_arg = sys.argv[1] if len(sys.argv) > 1 else None
    out_file = create_encrypted_backup(password=pwd_arg)
    size_kb = os.path.getsize(out_file) / 1024.0
    print(f"✅ Backup criptografado gerado com sucesso: {out_file} ({size_kb:.2f} KB)")
