import os
from dotenv import load_dotenv
import pandas as pd
from pymongo import MongoClient
import boto3

# Load environment variables from .env
load_dotenv()

MONGO_URI = os.getenv("MONGO_URI")
DB_NAME = "chromeExtensionAuth"
COLLECTION_NAME = "users"

def main():
    client = MongoClient(MONGO_URI)
    db = client[DB_NAME]
    collection = db[COLLECTION_NAME]
    data = list(collection.find({}))

    if not data:
        print("No data found in collection!")
        return

    # Clean each doc: remove password field, convert _id to string
    for doc in data:
        doc["_id"] = str(doc["_id"])
        if "password" in doc:
            del doc["password"]

    df = pd.DataFrame(data)
    df.to_excel("report.xlsx", index=False)
    print("report.xlsx written successfully!")
    
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
        print(f"✅ Uploaded {file_path} to s3://{bucket}/{os.path.basename(file_path)}")
    except Exception as e:
        print(f"❌ S3 upload failed: {e}")

if __name__ == "__main__":
    # First, run your ETL to create report.xlsx
    main()  # Assuming your main() creates report.xlsx
    # Then upload to S3
    upload_report_to_s3("report.xlsx")
