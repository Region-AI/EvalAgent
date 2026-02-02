#!/usr/bin/env bash

# --- Configuration ---

# Directory to inspect (defaults to current directory, or first arg override)
TARGET_DIR="${1:-.}"

# Output file name
OUTPUT_FILE="project_contents.txt"

# Folders to exclude
EXCLUDE_FOLDERS=(
  "build" "out" "node_modules" "dist" ".git" "alembic"
  "__pycache__" ".venv" "weights" "weights_save"
)

# Files to exclude (supports glob patterns)
EXCLUDE_FILES=(
  ".env" "package-lock.json" "*.ps1" "*.png" "*.jpg" "*.jpeg"
  "*.gif" "*.ico" "*.pdf" "*.zip" "*.rar" "*.7z" "*.exe"
  "*.dll" "*.bin" "*.save" "poetry.lock" "*.md" "*.sh"
  "*.json" "*.ipynb" "*.gitignore" "*.xml" "*.toml" "*.safetensors" "*.yaml" ".gitattributes" "*example*" "*.ini"
)

echo "Preparing to generate project contents for directory: '$TARGET_DIR'..."

# Resolve absolute path
ROOT_PATH="$(realpath "$TARGET_DIR")"
OUTPUT_PATH="$(pwd)/$OUTPUT_FILE"

# --- Remove old output file ---
if [[ -f "$OUTPUT_PATH" ]]; then
  echo "Removing existing '$OUTPUT_PATH'..."
  rm -f "$OUTPUT_PATH"
fi

echo "Processing project files..."

# Build folder exclusion regex (for grep -E)
FOLDER_REGEX=$(printf "|%s" "${EXCLUDE_FOLDERS[@]}")
FOLDER_REGEX="(${FOLDER_REGEX:1})"

# Temporary file list (will store all candidate files)
FILE_LIST=$(mktemp)

# Build find command with file exclusions
# We generate `-not -name pattern ...` dynamically
FIND_CMD=(find "$ROOT_PATH" -type f)

for patt in "${EXCLUDE_FILES[@]}"; do
  FIND_CMD+=(-not -name "$patt")
done

# Run find → store into FILE_LIST
"${FIND_CMD[@]}" > "$FILE_LIST"

# Process files
while IFS= read -r file; do
  # Skip files whose path contains excluded folders
  if echo "$file" | grep -E "/$FOLDER_REGEX(/|$)" >/dev/null; then
    continue
  fi

  # Compute relative path
  relative="${file#$ROOT_PATH/}"

  # Append content to output
  {
    printf "%s:\n" "$relative"
    printf "´´´\n"
    cat "$file"
    printf "\n´´´\n\n"
  } >> "$OUTPUT_PATH"

done < "$FILE_LIST"

rm -f "$FILE_LIST"

echo "Success! A new '$OUTPUT_PATH' has been created with the project contents."
