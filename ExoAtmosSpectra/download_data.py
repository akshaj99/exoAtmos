import os
import sys
import site
import warnings

# Add user-specific site-packages to Python path
user_site_packages = site.getusersitepackages()
sys.path.insert(0, user_site_packages)

import datetime
import json

# Suppress the urllib3 warning more aggressively
warnings.filterwarnings("ignore", category=Warning)
import urllib3
urllib3.disable_warnings()

print(f"Download script using Python interpreter: {sys.executable}")
print(f"Python version: {sys.version}")
print(f"Python path: {sys.path}")
print(f"User site-packages: {user_site_packages}")

try:
    import requests
    print("requests version:", requests.__version__)
except ImportError:
    print("The 'requests' module is not installed. You can install it using pip:")
    print(f"{sys.executable} -m pip install requests")
    print("After installing, please run this script again.")
    sys.exit(1)

try:
    import wget
    print("wget version:", wget.__version__)
except ImportError:
    print("The 'wget' module is not installed. You can install it using pip:")
    print(f"{sys.executable} -m pip install wget")
    print("After installing, please run this script again.")
    sys.exit(1)

# Set the working directory to the ExoAtmosSpectra folder on the desktop
desktop = os.path.join(os.path.expanduser("~"), "Desktop")
exoatmos_dir = os.path.join(desktop, "ExoAtmos")
working_dir = os.path.join(exoatmos_dir, "ExoAtmosSpectra")
os.chdir(working_dir)

# URL of the webpage
DOWNLOAD_URL = 'https://exoplanetarchive.ipac.caltech.edu/work/TMP_fx7Vn3_18881/atmospheres/tab1/wget_atmospheres.bat'

def download_data():
    # Send a GET request to the URL
    print("Fetching webpage...")
    try:
        response = requests.get(DOWNLOAD_URL)
        response.raise_for_status()  # Raises an HTTPError for bad responses
    except requests.exceptions.RequestException as e:
        print(f"Failed to retrieve the webpage. Error: {e}")
        return

    # Check if the request was successful
    if response.status_code == 200:
        # Get the text content of the page
        content = response.text
        
        # Full path of the output file
        output_file = os.path.join(working_dir, "paste.txt")
        
        # Open the file in write mode
        with open(output_file, 'w') as file:
            # Iterate through each line in the content
            for line in content.splitlines():
                # If the line doesn't start with '#', write it to the file
                if not line.strip().startswith('#'):
                    file.write(line + '\n')
        
        print(f"Content has been written to {output_file}")
    else:
        print(f"Failed to retrieve the webpage. Status code: {response.status_code}")
        return

    # Create a directory to store the downloaded files
    if not os.path.exists('downloaded_data'):
        os.makedirs('downloaded_data')

    # Read the content of the file
    with open('paste.txt', 'r') as file:
        content = file.read()

    # Split the content into lines
    lines = content.split('\n')

    # Iterate through the lines
    for line in lines:
        if line.startswith('wget -O'):
            # Split the line into parts
            parts = line.split()
            filename = parts[2]
            url = parts[3]
            
            # Download the file
            print(f"Downloading {filename}...")
            try:
                wget.download(url, out=os.path.join("downloaded_data", filename))
                print(" Done.")
            except Exception as e:
                print(f" Failed. Error: {str(e)}")

    # After successful download, update the last_update.json file
    update_time = datetime.datetime.now().isoformat()
    with open('last_update.json', 'w') as f:
        json.dump({'last_update': update_time}, f)

def check_update_needed():
    if not os.path.exists('last_update.json'):
        print("No previous update record found. Update is needed.")
        return True
    
    with open('last_update.json', 'r') as f:
        data = json.load(f)
    
    last_update = datetime.datetime.fromisoformat(data['last_update'])
    current_time = datetime.datetime.now()
    
    days_since_update = (current_time - last_update).days
    print(f"Days since last update: {days_since_update}")
    
    # Check if it's been more than a week since the last update
    return days_since_update >= 7

if __name__ == "__main__":
    if check_update_needed():
        print("Updating exoplanet data...")
        download_data()
        print("Update complete.")
    else:
        print("Data is up to date. No update needed.")
    
    print("\nIf you want to force an update, delete the 'last_update.json' file and run this script again.")