# ALB Error Analysis Script

This Python script analyzes AWS Application Load Balancer (ALB) access logs stored as `.gz` files to identify and count 4xx and 3xx HTTP errors by unique API endpoints. The script processes compressed log files, aggregates error occurrences, and generates a CSV report with details such as API endpoint, full request, method, response code, and occurrence count.

## Features
- Parses ALB logs in `.gz` format.
- Extracts unique API endpoints with their failure counts (excluding timestamps).
- Outputs results to a CSV file in a specified directory.
- Handles HTTP/2 logs and complex URLs with query parameters.
- Includes error handling for malformed log lines.

## Prerequisites
To run this script successfully, ensure the following are in place:

### 1. **Python Environment**
- Python 3.6 or higher.

### 2. **AWS Configured**
- Install aws cli
- make sure associated cli profile has necessary permission for s3:GetObject for specific bucket where your alb logs are stored.

### 3. **Local Environment**
- Create a folder where you will copy s3 objects to your local folder
- Create a folder for output the file processed by our script

#### 3.1 **Changes to be made in script**
- input_log_path = '/home/darshit/Darshit/alb_logs/*.gz'  # Your input .gz files path
- output_dir = '/home/darshit/Darshit/alb_logs/output'   # Your output directory
