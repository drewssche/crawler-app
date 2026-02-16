import os
import smtplib
from email.message import EmailMessage


def send_auth_code_email(email: str, code: str) -> bool:
    host = os.getenv("SMTP_HOST")
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD")
    sender = os.getenv("SMTP_FROM", user or "")
    port = int(os.getenv("SMTP_PORT", "587"))
    use_tls = os.getenv("SMTP_USE_TLS", "true").lower() == "true"

    if not host or not user or not password or not sender:
        return False

    msg = EmailMessage()
    msg["Subject"] = "Код входа в Crawler"
    msg["From"] = sender
    msg["To"] = email
    msg.set_content(f"Ваш код входа: {code}\nКод действует ограниченное время.")

    with smtplib.SMTP(host, port, timeout=10) as server:
        if use_tls:
            server.starttls()
        server.login(user, password)
        server.send_message(msg)

    return True
