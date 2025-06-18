import os
from dotenv import load_dotenv
import pandas as pd
from pymongo import MongoClient

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

if __name__ == "__main__":
    main()
