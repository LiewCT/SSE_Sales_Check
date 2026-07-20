import requests
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import json

options = Options()

# Use a clean Selenium profile
options.add_argument(r"--user-data-dir=C:\selenium_profile")

# Disable password manager and leak detection
options.add_experimental_option("prefs", {
    "credentials_enable_service": False,
    "profile.password_manager_enabled": False,
    "profile.password_manager_leak_detection": False
})

# Disable Chrome features
options.add_argument(
    "--disable-features=PasswordLeakDetection,PasswordCheck,PasswordManagerOnboarding"
)

# Optional: disable save password bubble
options.add_argument("--disable-save-password-bubble")

options.set_capability("goog:loggingPrefs", {"performance": "ALL"})

driver = webdriver.Chrome(options=options)
driver.maximize_window()
driver.execute_cdp_cmd("Network.enable", {})

cookies = driver.get_cookies()

session = requests.Session()

for cookie in cookies:
    session.cookies.set(cookie["name"], cookie["value"])

response = session.get(
    "https://ssegroup.com.my/api/approvals/datatables"
)

print(response.text)