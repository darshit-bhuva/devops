# AWS Lambda Backup Setup Guide

This guide provides step-by-step instructions to configure an AWS Lambda function for backing up an RDS MySQL database using `mysqldump`, compressing the output, and uploading it to Amazon S3 buckets. It covers prerequisites, dependency installation, packaging, and deployment.

## Prerequisites

### Local Environment
- **Python 3**: Install Python 3.8 or higher. Verify with `python3 --version`.
- **Code Editor**: Use Visual Studio Code (VS Code) or a similar editor for editing scripts.
- **AWS Lambda Knowledge**: Understand AWS Lambda function creation, environment variables, and IAM roles. Refer to [AWS Lambda Documentation](https://docs.aws.amazon.com/lambda/).

### AWS Lambda Configuration
Configure the following environment variables in your Lambda function to connect to RDS and S3. These are critical for the backup process.

| Variable Name                    | Description                                                                 |
|----------------------------------|-----------------------------------------------------------------------------|
| **`AWS_REGION`**                 | AWS region hosting your resources (e.g., `ap-south-1` for Mumbai).          |
| **`RDS_SECRET_NAME`**            | Name of the secret in AWS Secrets Manager containing RDS credentials.        |
| **`AWS_S3_BACKUP_BUCKET`**       | S3 bucket name for primary backup storage.                                  |
| **`AWS_S3_EXTRA_BACKUP_BUCKET`** | Cross-account S3 bucket name for additional backups.                        |
| **`S3_BACKUP_FOLDER`**           | Folder path in the primary S3 bucket (e.g., `sql/backups/`).                |
| **`S3_EXTRA_BACKUP_FOLDER`**     | Folder path in the cross-account S3 bucket (e.g., `sql/extra_backups/`).    |

> **Note**: Ensure the Lambda execution role has permissions for `secretsmanager:GetSecretValue`, `s3:PutObject` for both buckets, and `rds:DescribeDBInstances`. See [AWS IAM Policies](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html).

## Setup Steps

### 1. Cloning
- Clone the repository to your local machine:
  ```bash
  git clone <repository-url>
  ```
- Navigate to the repository directory:
  ```bash
  cd <repository-directory>
  ```

### 2. Package Installing
Run the following commands in the repository directory to install dependencies:

### 1. run "python3 -m pip install pymysql"
```bash
python3 -m pip install pymysql
```

### 2. run "wget https://archive.mariadb.org/mariadb-10.6.12/bintar-linux-systemd-x86_64/mariadb-10.6.12-linux-systemd-x86_64.tar.gz"
```bash
wget https://archive.mariadb.org/mariadb-10.6.12/bintar-linux-systemd-x86_64/mariadb-10.6.12-linux-systemd-x86_64.tar.gz
```

### 3. run "tar -xzf mariadb-10.6.12-linux-systemd-x86_64.tar.gz"
```bash
tar -xzf mariadb-10.6.12-linux-systemd-x86_64.tar.gz
```

### 4. run "cp mariadb-10.6.12-linux-systemd-x86_64/bin/mysqldump ."
```bash
cp mariadb-10.6.12-linux-systemd-x86_64/bin/mysqldump .
```

### 5. run "chmod +x mysqldump"
```bash
chmod +x mysqldump
```

### 6. run "rm -rf mariadb-10.6.12-linux-systemd-x86_64.tar.gz"
```bash
rm -rf mariadb-10.6.12-linux-systemd-x86_64.tar.gz
```

### 7. run "rm -rf mariadb-10.6.12-linux-systemd-x86_64/"
```bash
rm -rf mariadb-10.6.12-linux-systemd-x86_64/
```

> **Tip**: If the MariaDB URL is outdated, check [MariaDB Archives](https://mariadb.org/download/) for the latest compatible version.

### 3. Zipping
- Package all files (including `mysqldump`, Python scripts, and dependencies) into a zip file:
  ```bash
  zip -r lambda.zip .
  ```
- Verify the zip contains `mysqldump`, your Lambda script (e.g., `lambda_function.py`), and the `pymysql` library.

### 4. Uploading
- Upload the `lambda.zip` file to AWS Lambda:
  1. Open the [AWS Lambda Console](https://console.aws.amazon.com/lambda/).
  2. Select your Lambda function or create a new one.
  3. In the **Code** tab, click **Upload from** > **.zip file**.
  4. Upload `lambda.zip` and click **Save**.
  5. Deploy the function by clicking **Deploy**.

- Configure the Lambda function:
  - Set the handler to `lambda_function.lambda_handler` (adjust based on your script).
  - Allocate at least 1024 MB of memory and 2048 MB of ephemeral storage.
  - Set a timeout of 15 minutes to accommodate backup processes.

## Scheduling Backups
- Use Amazon EventBridge to schedule the Lambda function. For example, to run daily at 12:05 AM IST (18:35 UTC the previous day):
  - Create a rule in [EventBridge](https://console.aws.amazon.com/events/) with the cron expression:
    ```bash
    35 18 * * ? *
    ```
  - Target the Lambda function and save.

## Troubleshooting
- **Lambda Timeout**: If the function takes too long, increase memory to 2048 MB or optimize the `mysqldump` command with `--quick` and `--single-transaction`.
- **S3 Upload Errors**: Verify IAM permissions and bucket names. Check CloudWatch Logs for errors.
- **mysqldump Errors**: Ensure the binary is compatible with Amazon Linux 2. Avoid unsupported options like `--ssl-mode` or `--set-gtid-purged`.
- **Secrets Manager Access**: Confirm the secret name matches `RDS_SECRET_NAME` and contains valid RDS credentials.
- **CloudWatch Alarms**: Use CloudWatch Logs Insights to pinpoint errors:
  ```bash
  fields @timestamp, @message
  | filter @message like /ERROR/
  | sort @timestamp desc
  ```

## Platform-Specific Rendering
- **GitHub**: Renders tables and code blocks cleanly. Use relative links for repository files (e.g., `./lambda_function.py`).
- **GitLab**: Supports similar formatting but may require explicit line breaks after tables.
- **VS Code**: Install the `Markdown Preview Enhanced` extension for real-time rendering.
- **AWS Documentation**: If embedding in AWS Amplify or CodeCommit wikis, test table alignment and link accessibility.

## Notes
- **Performance**: Optimize `mysqldump` with minimal options (e.g., `--no-tablespaces`) and compress outputs using `gzip` before S3 upload.
- **Security**: Secure the S3 buckets with encryption and restrict access. Avoid exposing sensitive files.
- **Testing**: Test the Lambda function locally using `aws lambda invoke` or deploy to a test environment.
- **Versioning**: If using S3 versioning, create a lifecycle rule to retain the 7 most recent backups under `sql/` prefixes.