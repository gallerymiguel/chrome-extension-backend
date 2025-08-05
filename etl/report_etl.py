import os
from dotenv import load_dotenv
import pandas as pd
from pymongo import MongoClient
import boto3

# ==== NEW: Logging to CloudWatch ==== HAVE TO SETUP UP SOON
import logging
import watchtower

load_dotenv()

# Set up CloudWatch logging
logger = logging.getLogger("ETLLogger")
logger.setLevel(logging.INFO)

region_name = os.getenv("AWS_REGION")

logger.addHandler(
    watchtower.CloudWatchLogHandler(
        log_group="ETLReports",            # Name this whatever you want
        stream_name="etl-job",             # Can use date or job id for uniqueness
        region_name=region_name,
        create_log_group=True,
        create_log_stream=True,
    )
)

# ==== ENV VARS ====
MONGO_URI = os.getenv("MONGO_URI")
DB_NAME = "chromeExtensionAuth"
COLLECTION_NAME = "users"

def main():
    logger.info("Connecting to MongoDB...")
    client = MongoClient(MONGO_URI)
    db = client[DB_NAME]
    collection = db[COLLECTION_NAME]
    data = list(collection.find({}))

    if not data:
        logger.warning("No data found in collection!")
        return

    # Clean each doc: remove password field, convert _id to string
    for doc in data:
        doc["_id"] = str(doc["_id"])
        if "password" in doc:
            del doc["password"]

    df = pd.DataFrame(data)
    df.to_excel("report.xlsx", index=False)
    logger.info("report.xlsx written successfully!")

def upload_report_to_s3(file_path):
    access_key = os.getenv("AWS_ACCESS_KEY_ID")
    secret_key = os.getenv("AWS_SECRET_ACCESS_KEY")
    region = os.getenv("AWS_REGION")
    bucket = os.getenv("S3_BUCKET_NAME")

    s3 = boto3.client('s3',
                      aws_access_key_id=access_key,
                      aws_secret_access_key=secret_key,
                      region_name=region)
    try:
        s3.upload_file(file_path, bucket, os.path.basename(file_path))
        logger.info(f"✅ Uploaded {file_path} to s3://{bucket}/{os.path.basename(file_path)}")
    except Exception as e:
        logger.error(f"❌ S3 upload failed: {e}")

if __name__ == "__main__":
    logger.info("ETL script started")
    try:
        main()
        upload_report_to_s3("report.xlsx")
        logger.info("ETL script finished successfully.")
    except Exception as e:
        logger.error(f"ETL script failed: {e}")
