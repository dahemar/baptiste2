Scripts for uploading/copying videos to Cloudflare R2 and updating Google Sheets

1) Copy existing objects into `Audiovisual/` in R2

   npm install @aws-sdk/client-s3

   export R2_ENDPOINT="https://a9aa2c81cffdbdc0a558da017670f16c.r2.cloudflarestorage.com"
   export R2_BUCKET="<your-bucket-name>"
   export AWS_ACCESS_KEY_ID="7cbde63b01e4a7b98c49684f0aa47b31"
   export AWS_SECRET_ACCESS_KEY="2f58c4430b54ce17f883504510ca140f13daab2e2382d9c94a85a1bfd3f2b2cd"

   node scripts/copy_r2_objects.js "beni-1.mp4" "beni-2.mp4" > mapping.out.txt

   The script prints a JSON mapping between original keys and new public URLs. Save that to a file.

2) Update Google Sheets "Audiovisual" sheet with new URLs

   npm install googleapis yargs
   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/web-cora-ac37b5dec5b1.json"

   node scripts/update_sheets_audiovisual.js --spreadsheetId=<SPREADSHEET_ID> mapping.out.txt

 Notes
 - The scripts are intended to be run locally where you control credentials.
 - They perform server-side S3 CopyObject; only metadata and keys are changed.
 - Make a backup of the sheet before running batch replacements.
