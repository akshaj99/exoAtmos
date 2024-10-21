import os
import sys
import site
import glob
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import datetime
import json
import subprocess
import math
import traceback
import re

print(f"Python script started. Arguments: {sys.argv}", file=sys.stderr)
print(f"Current working directory: {os.getcwd()}", file=sys.stderr)
print(f"Contents of current directory: {os.listdir()}", file=sys.stderr)

# Add user-specific site-packages to Python path
user_site_packages = site.getusersitepackages()
sys.path.insert(0, user_site_packages)

# Set the working directory to the ExoAtmosSpectra folder
os.chdir(os.path.dirname(os.path.abspath(__file__)))

print(f"Working directory set to: {os.getcwd()}", file=sys.stderr)
print(f"Contents of working directory: {os.listdir()}", file=sys.stderr)

class NaNEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, float) and math.isnan(obj):
            return 'NaN'
        return super().default(obj)

def get_pl_name(filename):
    with open(filename, 'r') as f:
        for line in f:
            if line.startswith('\\PL_NAME'):
                # Remove leading/trailing whitespace and quotes
                pl_name = line.split('=')[1].strip().strip("'")
                return pl_name
    return None

def load_data(filename):
    full_path = os.path.join("downloaded_data", filename)
    if not os.path.exists(full_path):
        print(f"File does not exist: {full_path}")
        return None

    with open(full_path, 'r', encoding='utf-8') as f:
        content = f.read()

    metadata = {}
    data_lines = []
    headers = None
    reference = None

    for line in content.split('\n'):
        if line.startswith('\\'):
            parts = line.strip()[1:].split('=', 1)
            if len(parts) == 2:
                key, value = parts
                metadata[key.strip()] = value.strip().strip("'")
                if key.strip() == 'REFERENCE':
                    reference = value.strip().strip("'")
        elif line.startswith('|'):
            if headers is None:
                headers = [h.strip() for h in line.split('|') if h.strip()]
        elif line.strip() and not line.startswith('|'):
            data_lines.append(line)

    if not headers or not data_lines:
        print(f"No valid data found in the file {filename}")
        return None

    data = []
    for line in data_lines:
        values = line.split()
        if len(values) >= len(headers):
            row = dict(zip(headers, values[:len(headers)]))
            if reference:
                row['REFERENCE'] = reference
            elif 'REFERENCE' not in row:
                # If reference is not in metadata or the row, use the 12th column (index 11) as reference
                row['REFERENCE'] = values[11] if len(values) > 11 else 'Unknown'
            data.append(row)

    if not data:
        print(f"No valid data rows found in the file {filename}")
        return None

    df = pd.DataFrame(data)
    
    for col in df.columns:
        if col != 'REFERENCE':
            df[col] = pd.to_numeric(df[col], errors='ignore')

    return df, metadata

def determine_spectrum_type(df):
    if 'PL_TRANDEP' in df.columns:
        return 'transmission'
    elif 'ESPECLIPDEP' in df.columns:
        return 'eclipse'
    elif 'FLAM' in df.columns:
        return 'direct_imaging'
    else:
        return 'unknown'

def merge_planet_data():
    download_dir = "downloaded_data"
    duplicate_files = detect_duplicate_files(download_dir)
    if duplicate_files:
        print("Warning: Duplicate files detected:", file=sys.stderr)
        for file in duplicate_files:
            print(f"  {file}", file=sys.stderr)
        print("Please remove duplicate files manually before proceeding.", file=sys.stderr)
        return {}

    all_files = glob.glob(os.path.join(download_dir, "*.tbl"))
    if not all_files:
        print("No .tbl files found in the downloaded_data directory.", file=sys.stderr)
        return {}

    planet_data = {}
    total_files = len(all_files)
    processed_files = 0

    for file in all_files:
        pl_name = get_pl_name(file)
        if pl_name:
            result = load_data(os.path.basename(file))
            if result:
                df, metadata = result
                if not df.empty and not df.isnull().all().all():
                    spectrum_type = determine_spectrum_type(df)
                    if pl_name not in planet_data:
                        planet_data[pl_name] = {'data': [], 'metadata': []}
                    planet_data[pl_name]['data'].append(df)
                    planet_data[pl_name]['metadata'].append(metadata)
                    processed_files += 1
                    print(f"Processed file {file} for planet {pl_name}", file=sys.stderr)
                else:
                    print(f"Skipping file {file} as it contains no valid data.", file=sys.stderr)
            else:
                print(f"No valid data found for {pl_name} in {file}", file=sys.stderr)
        else:
            print(f"No planet name found in {file}", file=sys.stderr)

    print(f"Processed {processed_files} files out of {total_files}", file=sys.stderr)

    # Merge data for each planet
    for pl_name, data in planet_data.items():
        if data['data']:
            merged_df = pd.concat(data['data'], ignore_index=True)
            wavelength_column = next((col for col in merged_df.columns if 'WAVE' in col.upper()), None)
            if wavelength_column:
                merged_df = merged_df.sort_values(wavelength_column)
            planet_data[pl_name]['merged_data'] = merged_df
            print(f"Merged data for {pl_name}. Shape: {merged_df.shape}", file=sys.stderr)
        else:
            print(f"No data to merge for {pl_name}", file=sys.stderr)

    return planet_data

def search_planet(planet_data):
    search_term = input("Enter a planet name to search for: ").lower()
    
    matching_planets = [pl_name for pl_name in planet_data.keys() if search_term in pl_name.lower()]
    
    if not matching_planets:
        print("No matching planets found.")
        return
    
    if len(matching_planets) > 1:
        print(f"Found {len(matching_planets)} matching planets. Displaying data for the first match.")
    
    selected_planet = matching_planets[0]
    df = planet_data[selected_planet]['merged_data']
    metadata = planet_data[selected_planet]['metadata'][0]  # Using metadata from the first file
    
    print(f"\nData for {selected_planet}:")
    print(f"Number of data points: {len(df)}")
    print(df)
    
    wavelength_column = next((col for col in df.columns if 'WAVE' in col.upper()), None)
    if wavelength_column:
        print(f"\nWavelength range: {df[wavelength_column].min()} to {df[wavelength_column].max()}")
    else:
        print("\nNo wavelength column found in the data.")
    
    print("\nMetadata:")
    for key, value in metadata.items():
        print(f"{key}: {value}")
    
    # Plot the data
    plt.figure(figsize=(12, 6))
    if 'SPEC_PATH' in df.columns:
        for source in df['SPEC_PATH'].unique():
            source_data = df[df['SPEC_PATH'] == source]
            if wavelength_column and 'PL_TRANDEP' in df.columns and 'PL_TRANDEPERR1' in df.columns and 'PL_TRANDEPERR2' in df.columns:
                plt.errorbar(source_data[wavelength_column], source_data['PL_TRANDEP'], xerr=source_data['PL_TRANDEPERR1'], yerr=source_data['PL_TRANDEPERR2'], fmt='o', label=source)
                plt.xlabel('Central Wavelength (microns)')
                plt.ylabel('Transit Depth (%)')
                plt.title(f'Transmission Spectrum for {selected_planet}')
                plt.legend()
                plt.show()
            elif wavelength_column and 'PL_TRANDEP' in df.columns:
                plt.plot(source_data[wavelength_column], source_data['PL_TRANDEP'], 'o', label=source)
                plt.xlabel('Central Wavelength (microns)')
                plt.ylabel('Transit Depth (%)')
                plt.title(f'Transmission Spectrum for {selected_planet}')
                plt.legend()
                plt.show()
            else:
                print("Not enough data to plot transmission spectrum.")
            
            if wavelength_column and 'ESPECLIPDEP' in df.columns and 'ESPECLIPDEPERR1' in df.columns and 'ESPECLIPDEPERR2' in df.columns:
                plt.errorbar(source_data[wavelength_column], source_data['ESPECLIPDEP'], xerr=source_data['ESPECLIPDEPERR1'], yerr=source_data['ESPECLIPDEPERR2'], fmt='o', label=source)
                plt.xlabel('Central Wavelength (microns)')
                plt.ylabel('Eclipse Depth (%)')
                plt.title(f'Eclipse Spectrum for {selected_planet}')
                plt.legend()
                plt.show()
            elif wavelength_column and 'ESPECLIPDEP' in df.columns:
                plt.plot(source_data[wavelength_column], source_data['ESPECLIPDEP'], 'o', label=source)
                plt.xlabel('Central Wavelength (microns)')
                plt.ylabel('Eclipse Depth (%)')
                plt.title(f'Eclipse Spectrum for {selected_planet}')
                plt.legend()
                plt.show()
            else:
                print("Not enough data to plot eclipse spectrum.")
            
            if wavelength_column and 'FLAM' in df.columns and 'FLAMERR1' in df.columns and 'FLAMERR2' in df.columns:
                plt.errorbar(source_data[wavelength_column], source_data['FLAM'], xerr=source_data['FLAMERR1'], yerr=source_data['FLAMERR2'], fmt='o', label=source)
                plt.xlabel('Central Wavelength (microns)')
                plt.ylabel('F_Lambda (W/(m^2 microns))')
                plt.title(f'Direct Imaging Spectrum for {selected_planet}')
                plt.legend()
                plt.show()
            elif wavelength_column and 'FLAM' in df.columns:
                plt.plot(source_data[wavelength_column], source_data['FLAM'], 'o', label=source)
                plt.xlabel('Central Wavelength (microns)')
                plt.ylabel('F_Lambda (W/(m^2 microns))')
                plt.title(f'Direct Imaging Spectrum for {selected_planet}')
                plt.legend()
                plt.show()
            else:
                print("Not enough data to plot direct imaging spectrum.")
    else:
        if wavelength_column and 'PL_TRANDEP' in df.columns:
            plt.plot(df[wavelength_column], df['PL_TRANDEP'], 'o')
            plt.xlabel('Central Wavelength (microns)')
            plt.ylabel('Transit Depth (%)')
            plt.title(f'Transmission Spectrum for {selected_planet}')
            plt.legend()
            plt.show()
        else:
            print("Not enough data to plot transmission spectrum.")
        
        if wavelength_column and 'ESPECLIPDEP' in df.columns:
            plt.plot(df[wavelength_column], df['ESPECLIPDEP'], 'o')
            plt.xlabel('Central Wavelength (microns)')
            plt.ylabel('Eclipse Depth (%)')
            plt.title(f'Eclipse Spectrum for {selected_planet}')
            plt.legend()
            plt.show()
        else:
            print("Not enough data to plot eclipse spectrum.")
        
        if wavelength_column and 'FLAM' in df.columns:
            plt.plot(df[wavelength_column], df['FLAM'], 'o')
            plt.xlabel('Central Wavelength (microns)')
            plt.ylabel('F_Lambda (W/(m^2 microns))')
            plt.title(f'Direct Imaging Spectrum for {selected_planet}')
            plt.legend()
            plt.show()
        else:
            print("Not enough data to plot direct imaging spectrum.")

def check_update_needed():
    if not os.path.exists('last_update.json'):
        return True
    
    with open('last_update.json', 'r') as f:
        data = json.load(f)
    
    last_update = datetime.datetime.fromisoformat(data['last_update'])
    current_time = datetime.datetime.now()
    
    # Check if it's been more than a week since the last update
    return (current_time - last_update).days >= 7

def run_downloader():
    python_executable = sys.executable
    result = subprocess.run([python_executable, 'download_data.py'], capture_output=True, text=True)
    if result.returncode != 0:
        print("An error occurred while running the downloader script:")
        print(result.stderr)
        print("\nIt seems that some required modules are missing. Please install them using pip:")
        print(f"{python_executable} -m pip install requests wget")
        print("\nAfter installing the required modules, please run this script again.")
        sys.exit(1)

def detect_duplicate_files(directory):
    file_pattern = re.compile(r'(.+?)(?:\s*\(\d+\))?\.(tbl)$')
    file_groups = {}
    duplicate_files = []

    for filename in os.listdir(directory):
        if filename.endswith('.tbl'):
            match = file_pattern.match(filename)
            if match:
                base_name, extension = match.groups()
                if base_name not in file_groups:
                    file_groups[base_name] = [filename]
                else:
                    file_groups[base_name].append(filename)
                    duplicate_files.extend(file_groups[base_name])

    return duplicate_files

def get_planet_spectra(planet_name, planet_data):
    if planet_name not in planet_data:
        print(f"Planet {planet_name} not found in the dataset. Available planets: {list(planet_data.keys())}", file=sys.stderr)
        return {"error": f"Planet {planet_name} not found in the dataset"}

    df = planet_data[planet_name]['merged_data']
    spectra = {
        'transmission': [],
        'eclipse': [],
        'direct_imaging': []
    }
    
    wavelength_column = next((col for col in df.columns if 'WAVE' in col.upper()), None)
    
    if wavelength_column:
        if 'PL_TRANDEP' in df.columns:
            spectra['transmission'] = df[[wavelength_column, 'PL_TRANDEP', 'REFERENCE']].dropna().to_dict('records')
        
        if 'ESPECLIPDEP' in df.columns:
            spectra['eclipse'] = df[[wavelength_column, 'ESPECLIPDEP', 'REFERENCE']].dropna().to_dict('records')
        
        if 'FLAM' in df.columns:
            spectra['direct_imaging'] = df[[wavelength_column, 'FLAM', 'REFERENCE']].dropna().to_dict('records')
    
    # Check if any spectral data is available
    if not any(spectra.values()):
        return {"message": f"No spectral data available for {planet_name}"}
    
    return spectra

if __name__ == "__main__":
    print("Entering main block", file=sys.stderr)
    if len(sys.argv) > 1:
        planet_name = sys.argv[1]
        print(f"Searching for planet: {planet_name}", file=sys.stderr)
        try:
            if check_update_needed():
                print("Data update needed. Running downloader...", file=sys.stderr)
                run_downloader()
            
            planet_data = merge_planet_data()
            print(f"Planet data merged. Number of planets: {len(planet_data)}", file=sys.stderr)
            
            spectra = get_planet_spectra(planet_name, planet_data)
            print(f"Spectra retrieved: {spectra}", file=sys.stderr)
            
            print(json.dumps(spectra, cls=NaNEncoder))
        except Exception as e:
            error_message = f"Error processing spectra for {planet_name}: {str(e)}\n{traceback.format_exc()}"
            print(json.dumps({"error": error_message}), file=sys.stderr)
            sys.exit(1)
    else:
        print(json.dumps({"error": "No planet name provided"}))