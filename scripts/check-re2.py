"""Optional: pip install google-re2, then pipe export-rules.mjs to this script."""
import json
import sys
import re2

rules = json.load(sys.stdin)
for rule in rules:
    options = re2.Options()
    # Mirror Chromium CreateRE2Options: Latin1, case-insensitive, 2 KiB budget.
    options.encoding = re2.Options.Encoding.LATIN1
    options.case_sensitive = rule['condition'].get('isUrlFilterCaseSensitive', False)
    options.never_capture = rule['action']['type'] != 'redirect'
    options.max_mem = 2048
    options.log_errors = False
    compiled = re2.compile(rule['condition']['regexFilter'].encode('ascii'), options)
    print(f"PASS rule {rule['id']}: RE2 program size {compiled.programsize}, max_mem=2048")
