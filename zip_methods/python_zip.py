import zipfile
import os

def create_zip(zip_name, folder_to_zip):
    with zipfile.ZipFile(zip_name, 'w') as zipf:
        for root, dirs, files in os.walk(folder_to_zip):
            for file in files:
                zipf.write(os.path.join(root, file), 
                            os.path.relpath(os.path.join(root, file), 
                            os.path.join(folder_to_zip, '..')))

create_zip('output.zip', 'C:\path\to\your\folder')