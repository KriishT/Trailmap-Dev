import os

import sendgrid
from fastapi import FastAPI
from sendgrid.helpers.mail import Mail
from sqlalchemy import create_engine

engine = create_engine(os.environ["DATABASE_URL"])
sg = sendgrid.SendGridAPIClient(api_key=os.environ.get("SENDGRID_API_KEY"))

app = FastAPI()


@app.post("/welcome")
def welcome(address: str):
    message = Mail(from_email="hello@acme.io", to_emails=address, subject="Welcome", html_content="hi")
    sg.send(message)
    return {"sent": True}
