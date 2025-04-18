import os
import subprocess
import tarfile
import datetime
import boto3
import json
import logging
import shutil
import tempfile
import pymysql
from botocore.exceptions import ClientError

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Constants
AWS_REGION = os.environ.get("AWS_REGION") # Required, no default
SECRET_ID = os.environ.get("RDS_SECRET_NAME") # Required, no default
AWS_S3_BACKUP_BUCKET = os.environ.get("AWS_S3_BACKUP_BUCKET")  # Required, no default
AWS_S3_EXTRA_BACKUP_BUCKET = os.environ.get("AWS_S3_EXTRA_BACKUP_BUCKET")  # Required, no default
S3_BACKUP_FOLDER = os.environ.get("S3_BACKUP_FOLDER")  # Required, no default
S3_EXTRA_BACKUP_FOLDER = os.environ.get("S3_EXTRA_BACKUP_FOLDER")  # Required, no default
MYSQLDUMP_PATH = "/var/task/mysqldump"  # Path to mysqldump binary in Lambda package

def get_db_credentials(secret_id):
    """Retrieve RDS MySQL credentials from AWS Secrets Manager."""
    secrets_client = boto3.client('secretsmanager', region_name=AWS_REGION)
    try:
        logger.info("Fetching credentials from Secrets Manager")
        secret_response = secrets_client.get_secret_value(SecretId=secret_id)
        return json.loads(secret_response['SecretString'])
    except ClientError as e:
        logger.error(f"Failed to retrieve secrets: {str(e)}")
        raise

def get_database_list(host, port, user, password):
    """Fetch list of user databases from RDS MySQL, excluding system databases."""
    conn = pymysql.connect(
        host=host,
        port=int(port),
        user=user,
        password=password,
        connect_timeout=10
    )
    try:
        with conn.cursor() as cursor:
            cursor.execute("SHOW DATABASES")
            all_dbs = [row[0] for row in cursor.fetchall()]
            system_dbs = {'information_schema', 'mysql', 'performance_schema', 'sys'}
            user_dbs = [db for db in all_dbs if db not in system_dbs]
            return user_dbs
    finally:
        conn.close()

def run_mysqldump(username, password, host, port, db_name, output_file):
    """Run mysqldump to export an RDS MySQL database."""
    command = [
        MYSQLDUMP_PATH,
        f"--user={username}",
        f"--password={password}",
        f"--host={host}",
        f"--port={port}",
        db_name,
        "--result-file",
        output_file
    ]
    logger.info(f"Running mysqldump command for database {db_name} (password redacted)")
    try:
        result = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True
        )
        logger.info(f"mysqldump output for {db_name}: {result.stdout}")
        return True
    except subprocess.CalledProcessError as e:
        logger.error(f"mysqldump failed for {db_name}: {e.stderr}")
        raise Exception(f"mysqldump failed for {db_name}: {e.stderr}")

def create_tarball(source_dir, tar_path):
    """Create a .tar.gz archive of the backup directory."""
    logger.info(f"Creating tarball: {tar_path}")
    with tarfile.open(tar_path, "w:gz") as tar:
        for item in os.listdir(source_dir):
            tar.add(os.path.join(source_dir, item), arcname=item)
    logger.info(f"Created tarball: {tar_path}")

def upload_to_s3(tar_path, bucket, s3_key):
    """Upload the tarball to S3."""
    s3_client = boto3.client("s3", region_name=AWS_REGION)
    logger.info(f"Uploading to s3://{bucket}/{s3_key}")
    s3_client.upload_file(tar_path, bucket, s3_key)
    logger.info(f"Uploaded to s3://{bucket}/{s3_key}")

def lambda_handler(event, context):
    temp_dir = tempfile.mkdtemp(dir="/tmp")
    backup_dir = os.path.join(temp_dir, "backup")
    os.makedirs(backup_dir, exist_ok=True)
    
    try:
        # Check environment variables
        if not AWS_S3_BACKUP_BUCKET or not AWS_S3_EXTRA_BACKUP_BUCKET:
            raise ValueError("Missing required environment variables: AWS_S3_BACKUP_BUCKET or AWS_S3_EXTRA_BACKUP_BUCKET")
        if not S3_BACKUP_FOLDER or not S3_EXTRA_BACKUP_FOLDER:
            raise ValueError("Missing required environment variables: S3_BACKUP_FOLDER or S3_EXTRA_BACKUP_FOLDER")
        if not RDS_SECRET_NAME or not AWS_REGION:
            raise ValueError("Missing required environment variables: RDS_SECRET_NAME or AWS_REGION")

        # Fetch credentials from Secrets Manager
        secret = get_db_credentials(SECRET_ID)
        DB_USER = secret['username']
        DB_PASS = secret['password']
        DB_HOST = secret['host']
        DB_PORT = secret['port']
        
        logger.info(f"Starting backup for RDS MySQL at {DB_HOST}:{DB_PORT}")

        # Get list of user databases
        db_list = get_database_list(DB_HOST, DB_PORT, DB_USER, DB_PASS)
        logger.info(f"Found databases: {db_list}")

        if not db_list:
            raise ValueError("No user databases found to backup")

        # Run mysqldump for each database
        for db_name in db_list:
            output_file = os.path.join(backup_dir, f"{db_name}.sql")
            run_mysqldump(DB_USER, DB_PASS, DB_HOST, DB_PORT, db_name, output_file)
            file_size = os.path.getsize(output_file) / (1024 * 1024)  # Size in MB
            logger.info(f"Created SQL dump for {db_name}: {output_file}, Size: {file_size:.2f} MB")

        # Create tarball
        timestamp = datetime.datetime.now().strftime('%b%d_%Y_%H%M%S')
        tar_filename = os.path.join(temp_dir, f"backup_{timestamp}.tar.gz")
        create_tarball(backup_dir, tar_filename)

        # Generate S3 keys
        s3_key = f"{S3_BACKUP_FOLDER}/{timestamp}.tar.gz"
        s3_key_extra = f"{S3_EXTRA_BACKUP_FOLDER}/{timestamp}_extra.tar.gz"

        # Upload to S3 buckets
        upload_to_s3(tar_filename, AWS_S3_BACKUP_BUCKET, s3_key)
        upload_to_s3(tar_filename, AWS_S3_EXTRA_BACKUP_BUCKET, s3_key_extra)

        return {
            'statusCode': 200,
            'body': f'RDS MySQL backup successfully uploaded to S3 with timestamp: {timestamp}'
        }

    except Exception as e:
        logger.error(f"Error during execution: {str(e)}")
        return {
            'statusCode': 500,
            'body': f"Error: {str(e)}"
        }

    finally:
        # Clean up temporary directory
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
            logger.info(f"Cleaned up temporary directory: {temp_dir}")

if __name__ == "__main__":
    lambda_handler({}, {})