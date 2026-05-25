import json
import os

filepath = 'locales/en/translation.json'
with open(filepath, 'r', encoding='utf-8') as f:
    data = json.load(f)

# Keys to remove
bad_keys = [
    '', '.drag-handle', 'canvas', '2d',
    "auth.login', 'Login", "auth.signup', 'Sign Up",
    "create_menu.poll', 'Create Poll",
    "create_menu.quiz', 'Create Quiz",
    "create_menu.challenge', 'Create Challenge",
    "create_menu.survey', 'Create Survey",
    "create_menu.group', 'Create Group",
    "create_menu.business', 'Create Business Page",
    "Failed to update join policy', 'error",
    "Failed to update posting permissions', 'error",
    "Failed to update role', 'error",
    "Failed to delete group', 'error",
    "../services/api",
    "a", "-"
]

# Find the massive code block key
huge_keys = [k for k in data.keys() if 'onFollowStateChange' in k or len(k) > 100]

for k in bad_keys + huge_keys:
    if k in data:
        print(f"Removing key: {k[:50]}...")
        del data[k]

with open(filepath, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    
print('Cleaned translation.json')
