import gzip
import glob
import os
from collections import Counter
from datetime import datetime
import urllib.parse

def parse_alb_logs(log_file):
    # Store details for 4xx and 3xx errors: (url, full_request, method, status_code)
    errors_4xx = Counter()
    errors_3xx = Counter()

    with open(log_file, 'rt') if not log_file.endswith('.gz') else gzip.open(log_file, 'rt') as f:
        for line in f:
            try:
                # Split on spaces, but account for quoted fields
                fields = line.split(' ')
                if len(fields) < 13:
                    print(f"Skipping short line in {log_file}: {line.strip()}")
                    continue

                elb_status = fields[9]         # elb_status_code (e.g., 204, 304)
                request = ' '.join(fields[12:]).split('"')[1]  # Extract quoted request field
                request_parts = request.split()
                method = request_parts[0]      # Request method (e.g., GET, OPTIONS)
                
                # Extract URL and clean it
                full_url = request_parts[1]    # Full URL (e.g., https://bo-api.tmpbtex.com:443/api/...)
                parsed_url = urllib.parse.urlparse(full_url)
                url = parsed_url.path          # API endpoint (e.g., /api/payment/admin/deposit/list/v1)
                if parsed_url.query:
                    url += '?' + parsed_url.query  # Include query params
                full_request = request         # Full request (e.g., OPTIONS https://bo-api... HTTP/2.0)

                # Key for counting: (url, full_request, method, elb_status)
                error_key = (url, full_request, method, elb_status)

                if elb_status.startswith('4'):
                    errors_4xx[error_key] += 1
                elif elb_status.startswith('3'):
                    errors_3xx[error_key] += 1
            except (IndexError, ValueError) as e:
                print(f"Skipping malformed line in {log_file}: {line.strip()} (Error: {e})")
                continue

    return errors_4xx, errors_3xx

# Specify input and output directories
input_log_path = '/home/darshit/Darshit/alb_logs/*.gz'  # Your input .gz files path
output_dir = '/home/darshit/Darshit/alb_logs/output'   # Your output directory

# Ensure output directory exists
os.makedirs(output_dir, exist_ok=True)

# Generate output file with timestamp for uniqueness
output_file = os.path.join(output_dir, f'alb_error_analysis_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv')

# Process log files and collect errors
all_4xx = Counter()
all_3xx = Counter()

for log_file in glob.glob(input_log_path):
    print(f"Processing {log_file}...")
    e4xx, e3xx = parse_alb_logs(log_file)
    all_4xx.update(e4xx)
    all_3xx.update(e3xx)

# Aggregate unique endpoints by summing occurrences
unique_4xx = Counter()
unique_3xx = Counter()
for (url, full_request, method, status_code), count in all_4xx.items():
    unique_4xx[(url, full_request, method, status_code)] += count
for (url, full_request, method, status_code), count in all_3xx.items():
    unique_3xx[(url, full_request, method, status_code)] += count

# Write results to output file
with open(output_file, 'w') as f:
    # Write header
    f.write("Type,API_Endpoint,Full_Request,Method,Response_Code,Occurrence\n")

    # Write 4xx errors
    for (url, full_request, method, status_code), count in unique_4xx.items():
        url = url.replace('"', '""')
        full_request = full_request.replace('"', '""')
        f.write(f'4xx,"{url}","{full_request}","{method}",{status_code},{count}\n')

    # Write 3xx redirects
    for (url, full_request, method, status_code), count in unique_3xx.items():
        url = url.replace('"', '""')
        full_request = full_request.replace('"', '""')
        f.write(f'3xx,"{url}","{full_request}","{method}",{status_code},{count}\n')

print(f"Analysis complete. Results written to {output_file}")