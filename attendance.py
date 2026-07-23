import os
import sys
import time
from datetime import datetime, time as dt_time
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from selenium import webdriver
from selenium.common.exceptions import (
    NoSuchElementException,
    StaleElementReferenceException,
    WebDriverException,
)
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select, WebDriverWait
from selenium.webdriver.support import expected_conditions as EC


# =========================================================
# SETTINGS
# =========================================================

load_dotenv()

USERNAME = os.getenv("CLOCK_USERNAME")
PASSWORD = os.getenv("CLOCK_PASSWORD")
LOGIN_URL = os.getenv("LOGIN_URL")
ATTENDANCE_URL = os.getenv("ATTENDANCE_URL")
BRANCH_NAME = os.getenv(
    "BRANCH_NAME",
    "SSE SOUTH CITY"
)

HEADLESS = (
    os.getenv("HEADLESS", "false")
    .strip()
    .lower()
    == "true"
)

CHROME_USER_DATA_DIR = os.getenv(
    "CHROME_USER_DATA_DIR",
    ""
).strip().strip('"')

CHROME_PROFILE_DIRECTORY = os.getenv(
    "CHROME_PROFILE_DIRECTORY",
    "Default"
).strip().strip('"')

TIMEZONE = ZoneInfo(
    "Asia/Kuala_Lumpur"
)

USERNAME_XPATH = (
    "//label[normalize-space()='Username']"
    "/following-sibling::input[1]"
)

PASSWORD_XPATH = (
    "//label[normalize-space()='Password']"
    "/following-sibling::input[1]"
)

LOGIN_BUTTON_XPATH = (
    "//button[@type='submit' "
    "and contains(normalize-space(), 'Login')]"
)

BRANCH_SELECTOR = "select.clock-in-branch"
BUTTON_SELECTOR = "button.check-in-now"


if not all([
    USERNAME,
    PASSWORD,
    LOGIN_URL,
    ATTENDANCE_URL
]):
    raise ValueError(
        "Required .env settings are missing."
    )


def wait_for_browser_location():
    """Keep waiting until Chrome obtains the real device location."""
    print("Waiting for real device location...")

    driver.set_script_timeout(20)

    while True:
        try:
            result = driver.execute_async_script(
                """
                const done = arguments[0];

                if (!navigator.geolocation) {
                    done({
                        success: false,
                        error: "Geolocation is not supported."
                    });
                    return;
                }

                navigator.geolocation.getCurrentPosition(
                    position => {
                        done({
                            success: true,
                            latitude: position.coords.latitude,
                            longitude: position.coords.longitude,
                            accuracy: position.coords.accuracy
                        });
                    },
                    error => {
                        done({
                            success: false,
                            code: error.code,
                            error: error.message
                        });
                    },
                    {
                        enableHighAccuracy: false,
                        timeout: 15000,
                        maximumAge: 60000
                    }
                );
                """
            )

            print(
                "\rBrowser location result: "
                f"{result}",
                end="",
                flush=True
            )

            if result.get("success"):
                print("\nReal device location obtained.")
                return result

        except Exception as error:
            print(
                f"\nLocation check error: {error}"
            )

        print(
            "\nLocation unavailable. Retrying in 5 seconds..."
        )

        time.sleep(5)
# =========================================================
# ACTION
# =========================================================

if len(sys.argv) < 2:
    raise ValueError(
        "Run:\n"
        "python attendance.py checkin\n"
        "or\n"
        "python attendance.py checkout"
    )

ACTION = sys.argv[1].strip().lower()

if ACTION == "checkin":
    TARGET_TIME = dt_time(10, 0, 0)
    ACTION_NAME = "Check in"

elif ACTION == "checkout":
    TARGET_TIME = dt_time(19, 0, 0)
    ACTION_NAME = "Check out"

else:
    raise ValueError(
        "Action must be checkin or checkout."
    )


# =========================================================
# CHROME
# =========================================================

options = Options()

if HEADLESS:
    options.add_argument(
        "--headless=new"
    )

options.add_argument(
    "--window-size=1920,1080"
)
options.add_argument(
    "--disable-notifications"
)
options.add_argument(
    "--disable-popup-blocking"
)
options.add_argument(
    "--no-first-run"
)
options.add_argument(
    "--no-default-browser-check"
)

options.add_experimental_option(
    "prefs",
    {
        "profile.default_content_setting_values.geolocation": 1,
        "profile.default_content_setting_values.notifications": 2,
    }
)

if CHROME_USER_DATA_DIR:
    options.add_argument(
        f"--user-data-dir={CHROME_USER_DATA_DIR}"
    )

    options.add_argument(
        f"--profile-directory={CHROME_PROFILE_DIRECTORY}"
    )

driver = webdriver.Chrome(
    options=options
)

wait = WebDriverWait(
    driver,
    30
)

site_url = urlsplit(
    ATTENDANCE_URL
)

site_origin = (
    f"{site_url.scheme}://"
    f"{site_url.netloc}"
)


# =========================================================
# LOCATION PERMISSION
# =========================================================

def grant_location_permission():
    try:
        driver.execute_cdp_cmd(
            "Browser.setPermission",
            {
                "permission": {
                    "name": "geolocation"
                },
                "setting": "granted",
                "origin": site_origin
            }
        )

        print(
            "Location permission granted for:",
            site_origin
        )

    except WebDriverException as error:
        print(
            "Could not grant location permission:",
            error
        )


# =========================================================
# LOGIN
# =========================================================

def is_login_page():
    return bool(
        driver.find_elements(
            By.XPATH,
            USERNAME_XPATH
        )
    )


def login_if_needed():
    if not is_login_page():
        print(
            "Existing Chrome login session found."
        )
        return

    print(
        "Login required."
    )

    username_input = wait.until(
        EC.visibility_of_element_located(
            (
                By.XPATH,
                USERNAME_XPATH
            )
        )
    )

    password_input = wait.until(
        EC.visibility_of_element_located(
            (
                By.XPATH,
                PASSWORD_XPATH
            )
        )
    )

    username_input.clear()
    username_input.send_keys(
        USERNAME
    )

    password_input.clear()
    password_input.send_keys(
        PASSWORD
    )

    remember_checkbox = driver.find_elements(
        By.ID,
        "rememberCheck"
    )

    if (
        remember_checkbox
        and not remember_checkbox[0].is_selected()
    ):
        remember_checkbox[0].click()

    login_button = wait.until(
        EC.element_to_be_clickable(
            (
                By.XPATH,
                LOGIN_BUTTON_XPATH
            )
        )
    )

    login_button.click()

    wait.until(
        lambda current_driver: (
            not current_driver.find_elements(
                By.XPATH,
                USERNAME_XPATH
            )
        )
    )

    print(
        "Login successful."
    )


# =========================================================
# BRANCH
# =========================================================

def wait_for_required_branch():
    print(
        f"Waiting for branch: {BRANCH_NAME}..."
    )

    while True:
        try:
            dropdown = driver.find_element(
                By.CSS_SELECTOR,
                BRANCH_SELECTOR
            )

            branch_select = Select(
                dropdown
            )

            available_branches = [
                option.text.strip()
                for option in branch_select.options
            ]

            selected_branch = (
                branch_select
                .first_selected_option
                .text
                .strip()
            )

            print(
                f"\rCurrent branch: {selected_branch}",
                end="",
                flush=True
            )

            if selected_branch == BRANCH_NAME:
                print(
                    f"\nBranch ready: {BRANCH_NAME}"
                )
                return

            if BRANCH_NAME in available_branches:
                branch_select.select_by_visible_text(
                    BRANCH_NAME
                )

                driver.execute_script(
                    """
                    arguments[0].dispatchEvent(
                        new Event('input', {
                            bubbles: true
                        })
                    );

                    arguments[0].dispatchEvent(
                        new Event('change', {
                            bubbles: true
                        })
                    );
                    """,
                    dropdown
                )

                time.sleep(1)

        except (
            NoSuchElementException,
            StaleElementReferenceException
        ):
            pass

        time.sleep(0.5)


# =========================================================
# WAIT FOR TARGET TIME
# =========================================================

def wait_until_target(target_datetime):
    now = datetime.now(
        TIMEZONE
    )

    if now >= target_datetime:
        print(
            f"The target time has passed. "
            f"Trying to {ACTION_NAME.lower()} now."
        )
        return

    print(
        f"{ACTION_NAME} will click at "
        f"{target_datetime:%I:%M:%S %p}."
    )

    while True:
        now = datetime.now(
            TIMEZONE
        )

        remaining = (
            target_datetime - now
        ).total_seconds()

        if remaining <= 10:
            break

        print(
            f"\rCurrent: {now:%I:%M:%S %p} | "
            f"Remaining: {int(remaining)} seconds",
            end="",
            flush=True
        )

        time.sleep(
            min(
                max(remaining - 10, 1),
                30
            )
        )

    print(
        "\nFinal 10-second countdown started."
    )

    while datetime.now(TIMEZONE) < target_datetime:
        time.sleep(0.002)


# =========================================================
# CLICK ATTENDANCE BUTTON
# =========================================================

def click_attendance_button():
    last_refresh = time.monotonic()

    while True:
        try:
            button = driver.find_element(
                By.CSS_SELECTOR,
                BUTTON_SELECTOR
            )

            button_text = (
                button.text.strip()
            )

            button_active = (
                button.is_displayed()
                and button.is_enabled()
            )

            print(
                f"\rButton: {button_text} | "
                f"Active: {button_active}",
                end="",
                flush=True
            )

            if button_active:
                click_time = datetime.now(
                    TIMEZONE
                )

                try:
                    button.click()

                except WebDriverException:
                    driver.execute_script(
                        "arguments[0].click();",
                        button
                    )

                print(
                    f"\n{ACTION_NAME} clicked at "
                    f"{click_time:%I:%M:%S.%f %p}."
                )

                time.sleep(3)
                return

        except (
            NoSuchElementException,
            StaleElementReferenceException
        ):
            print(
                "\rWaiting for attendance button...",
                end="",
                flush=True
            )

        if time.monotonic() - last_refresh >= 2:
            print(
                "\nRefreshing attendance page..."
            )

            driver.refresh()

            wait.until(
                EC.presence_of_element_located(
                    (
                        By.CSS_SELECTOR,
                        BRANCH_SELECTOR
                    )
                )
            )

            wait_for_required_branch()

            last_refresh = time.monotonic()

        time.sleep(0.05)


# =========================================================
# MAIN PROGRAM
# =========================================================

try:
    grant_location_permission()

    print(
        f"Opening: {ATTENDANCE_URL}"
    )

    driver.get(ATTENDANCE_URL)

    wait_for_browser_location()

    wait.until(
        EC.presence_of_element_located(
            (
                By.CSS_SELECTOR,
                BRANCH_SELECTOR
            )
        )
    )

    wait_for_required_branch()

    time.sleep(2)

    login_if_needed()

    if is_login_page():
        raise RuntimeError(
            "Login did not complete."
        )

    if driver.current_url.rstrip("/") != ATTENDANCE_URL.rstrip("/"):
        print(
            f"Opening: {ATTENDANCE_URL}"
        )

        driver.get(
            ATTENDANCE_URL
        )

    wait.until(
        EC.presence_of_element_located(
            (
                By.CSS_SELECTOR,
                BRANCH_SELECTOR
            )
        )
    )

    wait_for_required_branch()

    wait.until(
        EC.presence_of_element_located(
            (
                By.CSS_SELECTOR,
                BUTTON_SELECTOR
            )
        )
    )

    target_datetime = datetime.combine(
        datetime.now(TIMEZONE).date(),
        TARGET_TIME,
        tzinfo=TIMEZONE
    )

    wait_until_target(
        target_datetime
    )

    click_attendance_button()

    print(
        f"{ACTION_NAME} completed. "
        "Program ended."
    )

except KeyboardInterrupt:
    print(
        "\nProgram stopped by the user."
    )

except Exception as error:
    print(
        f"\nError: {error}"
    )

finally:
    driver.quit()

    print(
        "Browser closed."
    )