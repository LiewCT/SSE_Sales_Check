import os
import time
from datetime import datetime, time as datetime_time, timedelta
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select, WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import (
    NoSuchElementException,
    StaleElementReferenceException,
    TimeoutException,
    WebDriverException,
)


# =========================================================
# LOAD .ENV SETTINGS
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
    os.getenv("HEADLESS", "true")
    .strip()
    .lower()
    == "true"
)


if not USERNAME:
    raise ValueError(
        "CLOCK_USERNAME is missing from the .env file."
    )

if not PASSWORD:
    raise ValueError(
        "CLOCK_PASSWORD is missing from the .env file."
    )

if not LOGIN_URL:
    raise ValueError(
        "LOGIN_URL is missing from the .env file."
    )

if not ATTENDANCE_URL:
    raise ValueError(
        "ATTENDANCE_URL is missing from the .env file."
    )


# =========================================================
# TIME SETTINGS
# =========================================================

MALAYSIA_TIMEZONE = ZoneInfo(
    "Asia/Kuala_Lumpur"
)

MORNING_TIME = datetime_time(10, 0)
EVENING_TIME = datetime_time(19, 0)


def malaysia_now():
    """Return the current Malaysia date and time."""
    return datetime.now(MALAYSIA_TIMEZONE)


# =========================================================
# HTML SELECTORS
# =========================================================

USERNAME_XPATH = (
    "//form"
    "//label[normalize-space()='Username']"
    "/following-sibling::input[1]"
)

PASSWORD_XPATH = (
    "//form"
    "//label[normalize-space()='Password']"
    "/following-sibling::input[1]"
)

LOGIN_BUTTON_XPATH = (
    "//form"
    "//button[@type='submit'"
    " and contains(normalize-space(), 'Login')]"
)

BRANCH_SELECTOR = "select.clock-in-branch"

BUTTON_SELECTOR = "button.check-in-now"


# =========================================================
# START CHROME
# =========================================================

chrome_options = Options()

if HEADLESS:
    chrome_options.add_argument(
        "--headless=new"
    )

chrome_options.add_argument(
    "--start-maximized"
)

chrome_options.add_argument(
    "--disable-notifications"
)

chrome_options.add_argument(
    "--disable-popup-blocking"
)

driver = webdriver.Chrome(
    options=chrome_options
)

wait = WebDriverWait(driver, 30)


# =========================================================
# PAGE FUNCTIONS
# =========================================================

def wait_for_page_ready():
    """Wait until the web page finishes loading."""
    WebDriverWait(driver, 30).until(
        lambda current_driver: (
            current_driver.execute_script(
                "return document.readyState"
            )
            == "complete"
        )
    )


def is_login_page():
    """Check whether the login form is currently displayed."""
    username_inputs = driver.find_elements(
        By.XPATH,
        USERNAME_XPATH
    )

    password_inputs = driver.find_elements(
        By.XPATH,
        PASSWORD_XPATH
    )

    return bool(
        username_inputs and password_inputs
    )


def login():
    """Open the login page and log in."""
    print("\nOpening login page...")

    driver.get(LOGIN_URL)
    wait_for_page_ready()

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
    username_input.send_keys(USERNAME)

    password_input.clear()
    password_input.send_keys(PASSWORD)

    # Select Remember Me when available
    remember_checkboxes = driver.find_elements(
        By.ID,
        "rememberCheck"
    )

    if remember_checkboxes:
        remember_checkbox = remember_checkboxes[0]

        if not remember_checkbox.is_selected():
            remember_checkbox.click()

        print("Remember Me selected.")

    login_button = wait.until(
        EC.element_to_be_clickable(
            (
                By.XPATH,
                LOGIN_BUTTON_XPATH
            )
        )
    )

    login_button.click()

    print("Login button clicked.")

    try:
        WebDriverWait(driver, 30).until(
            lambda current_driver: (
                not is_login_page()
            )
        )

        print("Login successful.")

    except TimeoutException:
        raise RuntimeError(
            "Login did not complete. "
            "Please check the username, password, "
            "website URL, CAPTCHA or verification."
        )


def open_attendance_page():
    """Open the attendance page and log in again if needed."""
    print("\nOpening attendance page...")

    driver.get(ATTENDANCE_URL)
    wait_for_page_ready()

    if is_login_page():
        print(
            "Login is required or the session expired."
        )

        login()

        driver.get(ATTENDANCE_URL)
        wait_for_page_ready()

    try:
        WebDriverWait(driver, 30).until(
            EC.presence_of_element_located(
                (
                    By.CSS_SELECTOR,
                    BRANCH_SELECTOR
                )
            )
        )

        print("Attendance page loaded.")

    except TimeoutException:
        raise RuntimeError(
            "The branch dropdown was not found. "
            "Check ATTENDANCE_URL or the CSS selector."
        )


# =========================================================
# WAIT FOR TIME
# =========================================================

def wait_until_datetime(target_datetime):
    """Wait until a specific Malaysia date and time."""
    while True:
        current_datetime = malaysia_now()

        if current_datetime >= target_datetime:
            print(
                "\nTarget time reached:",
                current_datetime.strftime(
                    "%d %B %Y, %I:%M:%S %p"
                )
            )
            return

        remaining_seconds = int(
            (
                target_datetime
                - current_datetime
            ).total_seconds()
        )

        print(
            "\rCurrent Malaysia time: "
            f"{current_datetime.strftime('%I:%M:%S %p')} | "
            f"Waiting: {remaining_seconds} seconds",
            end="",
            flush=True
        )

        # Check once per minute when far away
        # and more frequently when close
        if remaining_seconds > 60:
            time.sleep(60)
        else:
            time.sleep(1)


# =========================================================
# BRANCH AND BUTTON CHECK
# =========================================================

def get_selected_branch():
    """Read the automatically selected branch text."""
    dropdown = driver.find_element(
        By.CSS_SELECTOR,
        BRANCH_SELECTOR
    )

    selected_option = (
        Select(dropdown)
        .first_selected_option
    )

    return selected_option.text.strip()


def get_button_status():
    """Return the button element, text and active status."""
    button = driver.find_element(
        By.CSS_SELECTOR,
        BUTTON_SELECTOR
    )

    button_text = button.text.strip()

    button_active = (
        button.is_displayed()
        and button.is_enabled()
    )

    return (
        button,
        button_text,
        button_active
    )


def wait_for_branch_and_active_button(
    deadline_datetime,
    action_name
):
    """
    Wait until:
    1. SSE SOUTH CITY is selected.
    2. The attendance button is visible and active.
    3. Then click the button.
    """
    print(
        f"\nWaiting for {action_name} conditions..."
    )

    last_refresh_time = time.monotonic()

    while malaysia_now() < deadline_datetime:
        try:
            # Login again if the session expires
            if is_login_page():
                print(
                    "\nSession expired. Logging in again..."
                )

                login()

                driver.get(ATTENDANCE_URL)
                wait_for_page_ready()

            selected_branch = get_selected_branch()

            (
                button,
                button_text,
                button_active
            ) = get_button_status()

            print(
                "\r"
                f"Branch: {selected_branch} | "
                f"Button: {button_text} | "
                f"Active: {button_active}",
                end="",
                flush=True
            )

            branch_correct = (
                selected_branch == BRANCH_NAME
            )

            if branch_correct and button_active:
                # Check time again immediately before clicking
                click_time = malaysia_now()

                if click_time >= deadline_datetime:
                    print(
                        "\nThe action deadline has passed."
                    )
                    return False

                button.click()

                print(
                    f"\n{action_name} button clicked at "
                    f"{click_time.strftime('%I:%M:%S %p')}."
                )

                verify_button_changed()

                return True

        except (
            NoSuchElementException,
            StaleElementReferenceException
        ):
            print(
                "\rWaiting for the page elements...",
                end="",
                flush=True
            )

        except WebDriverException as error:
            print(
                f"\nBrowser error while checking: {error}"
            )

        # Refresh every 15 seconds so new button
        # and branch states can be loaded
        current_monotonic = time.monotonic()

        if (
            current_monotonic
            - last_refresh_time
            >= 15
        ):
            try:
                driver.refresh()
                wait_for_page_ready()
            except WebDriverException:
                pass

            last_refresh_time = current_monotonic

        time.sleep(2)

    print(
        f"\n{action_name} was not clicked "
        "before its deadline."
    )

    return False


def verify_button_changed():
    """
    Wait briefly for the button to become disabled,
    disappear, or change after clicking.
    """
    try:
        WebDriverWait(driver, 15).until(
            lambda current_driver: (
                not current_driver.find_elements(
                    By.CSS_SELECTOR,
                    BUTTON_SELECTOR
                )
                or not current_driver.find_element(
                    By.CSS_SELECTOR,
                    BUTTON_SELECTOR
                ).is_enabled()
            )
        )

        print(
            "The website processed the button click."
        )

    except TimeoutException:
        print(
            "The button was clicked, but its state "
            "did not change within 15 seconds."
        )


# =========================================================
# SCHEDULED ACTION
# =========================================================

def perform_scheduled_action(
    target_datetime,
    deadline_datetime,
    action_name
):
    """
    Wait for the target time, open the attendance page,
    check the branch and button, then click.
    """
    current_datetime = malaysia_now()

    if current_datetime >= deadline_datetime:
        print(
            f"\n{action_name} skipped because "
            "its time window has ended."
        )
        return False

    if current_datetime < target_datetime:
        print(
            f"\n{action_name} scheduled for "
            f"{target_datetime.strftime('%I:%M %p')}."
        )

        wait_until_datetime(
            target_datetime
        )

    else:
        print(
            f"\nIt is already after "
            f"{target_datetime.strftime('%I:%M %p')}."
        )

    # Check time again after waiting
    if malaysia_now() >= deadline_datetime:
        print(
            f"{action_name} skipped because "
            "its deadline has passed."
        )
        return False

    open_attendance_page()

    return wait_for_branch_and_active_button(
        deadline_datetime,
        action_name
    )


# =========================================================
# MAIN PROGRAM
# =========================================================

def main():
    today = malaysia_now().date()

    morning_target = datetime.combine(
        today,
        MORNING_TIME,
        tzinfo=MALAYSIA_TIMEZONE
    )

    evening_target = datetime.combine(
        today,
        EVENING_TIME,
        tzinfo=MALAYSIA_TIMEZONE
    )

    # The morning action can run from
    # 10:00 AM until before 7:00 PM
    morning_deadline = evening_target

    # The evening action can run from
    # 7:00 PM until midnight
    evening_deadline = datetime.combine(
        today + timedelta(days=1),
        datetime_time(0, 0),
        tzinfo=MALAYSIA_TIMEZONE
    )

    print(
        "Attendance automation started."
    )

    print(
        "Malaysia date:",
        malaysia_now().strftime(
            "%d %B %Y"
        )
    )

    print(
        "Required branch:",
        BRANCH_NAME
    )

    # Login at the beginning
    login()

    # 10:00 AM action
    morning_result = perform_scheduled_action(
        target_datetime=morning_target,
        deadline_datetime=morning_deadline,
        action_name="10:00 AM action"
    )

    print(
        "\n10:00 AM result:",
        "Completed"
        if morning_result
        else "Not completed"
    )

    # 7:00 PM action
    evening_result = perform_scheduled_action(
        target_datetime=evening_target,
        deadline_datetime=evening_deadline,
        action_name="7:00 PM action"
    )

    print(
        "\n7:00 PM result:",
        "Completed"
        if evening_result
        else "Not completed"
    )

    print(
        "\nToday's automation has finished."
    )


# =========================================================
# RUN
# =========================================================

if __name__ == "__main__":
    try:
        main()

    except KeyboardInterrupt:
        print(
            "\nAutomation stopped by the user."
        )

    except Exception as error:
        print(
            f"\nAutomation error: {error}"
        )

    finally:
        driver.quit()
        print("Browser closed.")