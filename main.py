from datetime import datetime, timezone
import json
import os
import sqlite3

from flask import Flask, jsonify, request
from flask_cors import CORS
import requests


app = Flask(__name__)
CORS(app)


# You can override these values in Render environment variables.
SSE_CI_SESSION = os.environ.get(
    "SSE_CI_SESSION",
    "ulm4c23nss30k6c97rn1tif7s7rut4ic"
)

SSE_AUTHORIZATION = os.environ.get(
    "SSE_AUTHORIZATION",
    "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9."
    "eyJ1c2VyX25hbWUiOiJKb2pvMzMifQ."
    "Y2m-K7E-uDfpqoBIN8fwZ7CfXgQfo57LYBulj8MOzDA"
)

# Local default: packaging_status.db beside main.py.
# Render persistent disk example:
# PACKAGING_DB_PATH=/var/data/packaging_status.db
DATABASE_PATH = os.environ.get(
    "PACKAGING_DB_PATH",
    os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "packaging_status.db"
    )
)

REQUEST_TIMEOUT_SECONDS = 30


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def get_database_connection():
    database_directory = os.path.dirname(DATABASE_PATH)

    if database_directory:
        os.makedirs(
            database_directory,
            exist_ok=True
        )

    connection = sqlite3.connect(
        DATABASE_PATH,
        timeout=30
    )

    connection.row_factory = sqlite3.Row

    connection.execute(
        "PRAGMA journal_mode=WAL"
    )

    connection.execute(
        "PRAGMA busy_timeout=30000"
    )

    return connection


def initialize_database():
    with get_database_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS packaging_status (
                order_id TEXT NOT NULL,
                item_id TEXT NOT NULL,
                product_code TEXT NOT NULL,
                packaged INTEGER NOT NULL DEFAULT 0,
                last_quantity REAL NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (order_id, item_id),
                CHECK (packaged IN (0, 1))
            )
            """
        )


def build_sse_session():
    session = requests.Session()

    session.cookies.set(
        "ci_session",
        SSE_CI_SESSION,
        domain="ssegroup.com.my"
    )

    return session


def build_sse_headers():
    return {
        "Authorization": SSE_AUTHORIZATION,
        "Content-Type": (
            "application/x-www-form-urlencoded; "
            "charset=UTF-8"
        ),
        "Accept": (
            "application/json, text/javascript, "
            "*/*; q=0.01"
        ),
        "Referer": (
            "https://ssegroup.com.my/approvals"
        ),
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0"
    }


def build_approvals_payload():
    return {
        "draw": "1",
        "start": "0",
        "length": "100",
        "search[value]": json.dumps({
            "date_start": "",
            "date_end": "",
            "search": "",
            "sale_branch": 1,
            "sale_status": {
                "Pending": True,
                "Approved": False,
                "Rejected": False,
                "Invoiced": False,
                "NotInvoiced": False,
                "PreOrder": True,
                "Reserved": False
            },
            "sale_dealer": "",
            "proforma_invoiced": False,
            "pro_forma_code": ""
        }),
        "search[regex]": "false"
    }


def make_unique_item_id(record, item_index, used_item_ids):
    """
    Prefer the source record ID because it remains stable.
    Fall back to product code when the source API does not
    provide a record ID.
    """
    base_item_id = str(
        record.get("id")
        or record.get("sale_record_id")
        or record.get("record_id")
        or record.get("product_id")
        or record.get("product_code")
        or f"item-{item_index}"
    )

    occurrence = used_item_ids.get(
        base_item_id,
        0
    )

    used_item_ids[base_item_id] = (
        occurrence + 1
    )

    if occurrence == 0:
        return base_item_id

    return f"{base_item_id}::{occurrence}"


def to_number(value):
    try:
        number = float(value)

        if number.is_integer():
            return int(number)

        return number
    except (TypeError, ValueError):
        return 0


def get_shared_packaging_status(
    connection,
    order_id,
    item_id,
    product_code,
    current_quantity
):
    """
    New items begin unpacked.

    When the source quantity increases, the backend resets
    the item to unpacked for every browser because additional
    units must be packed.
    """
    existing_status = connection.execute(
        """
        SELECT packaged, last_quantity, product_code
        FROM packaging_status
        WHERE order_id = ? AND item_id = ?
        """,
        (order_id, item_id)
    ).fetchone()

    now = utc_now_iso()

    if existing_status is None:
        connection.execute(
            """
            INSERT INTO packaging_status (
                order_id,
                item_id,
                product_code,
                packaged,
                last_quantity,
                updated_at
            )
            VALUES (?, ?, ?, 0, ?, ?)
            """,
            (
                order_id,
                item_id,
                product_code,
                current_quantity,
                now
            )
        )

        return False

    packaged = bool(
        existing_status["packaged"]
    )

    previous_quantity = to_number(
        existing_status["last_quantity"]
    )

    quantity_increased = (
        current_quantity > previous_quantity
    )

    if quantity_increased:
        packaged = False

    database_needs_update = any([
        quantity_increased,
        current_quantity != previous_quantity,
        product_code != existing_status["product_code"]
    ])

    if database_needs_update:
        connection.execute(
            """
            UPDATE packaging_status
            SET product_code = ?,
                packaged = ?,
                last_quantity = ?,
                updated_at = ?
            WHERE order_id = ? AND item_id = ?
            """,
            (
                product_code,
                int(packaged),
                current_quantity,
                now,
                order_id,
                item_id
            )
        )

    return packaged


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok"
    })


@app.route("/packaging-status", methods=["PUT"])
def update_packaging_status():
    body = request.get_json(silent=True)

    if not isinstance(body, dict):
        return jsonify({
            "error": "JSON body is required."
        }), 400

    order_id = str(
        body.get("order_id", "")
    ).strip()

    item_id = str(
        body.get("item_id", "")
    ).strip()

    packaged = body.get("packaged")
    product_code = str(
        body.get("product_code", "")
    )
    quantity = to_number(
        body.get("quantity")
    )

    if not order_id:
        return jsonify({
            "error": "order_id is required."
        }), 400

    if not item_id:
        return jsonify({
            "error": "item_id is required."
        }), 400

    if not isinstance(packaged, bool):
        return jsonify({
            "error": "packaged must be true or false."
        }), 400

    with get_database_connection() as connection:
        connection.execute(
            "BEGIN IMMEDIATE"
        )

        existing_status = connection.execute(
            """
            SELECT product_code, last_quantity
            FROM packaging_status
            WHERE order_id = ? AND item_id = ?
            """,
            (order_id, item_id)
        ).fetchone()

        if existing_status is None:
            connection.execute(
                """
                INSERT INTO packaging_status (
                    order_id,
                    item_id,
                    product_code,
                    packaged,
                    last_quantity,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    order_id,
                    item_id,
                    product_code,
                    int(packaged),
                    quantity,
                    utc_now_iso()
                )
            )
        else:
            connection.execute(
                """
                UPDATE packaging_status
                SET packaged = ?,
                    updated_at = ?
                WHERE order_id = ? AND item_id = ?
                """,
                (
                    int(packaged),
                    utc_now_iso(),
                    order_id,
                    item_id
                )
            )

    return jsonify({
        "order_id": order_id,
        "item_id": item_id,
        "packaged": packaged
    })


@app.route("/approvals", methods=["GET"])
def approvals():
    session = build_sse_session()
    headers = build_sse_headers()

    try:
        response = session.post(
            "https://ssegroup.com.my/api/approvals/datatables",
            headers=headers,
            data=build_approvals_payload(),
            timeout=REQUEST_TIMEOUT_SECONDS
        )

        response.raise_for_status()
        data = response.json()

        rows = data.get("data", [])
        result = []

        with get_database_connection() as connection:
            # Lock writes while item quantities and shared
            # packaging states are synchronised.
            connection.execute(
                "BEGIN IMMEDIATE"
            )

            for row in rows:
                link = row[9].split(
                    'href="',
                    1
                )[1].split('"', 1)[0]

                sale_id = link.rstrip(
                    "/"
                ).split("/")[-1]

                sale_response = session.get(
                    (
                        "https://ssegroup.com.my/"
                        f"api/sales/{sale_id}"
                    ),
                    headers=headers,
                    timeout=REQUEST_TIMEOUT_SECONDS
                )

                sale_response.raise_for_status()
                sale_data = sale_response.json()

                records = (
                    sale_data
                    .get("data", {})
                    .get("record", {})
                    .get("records", [])
                )

                items = []
                used_item_ids = {}

                for item_index, record in enumerate(records):
                    product_code = str(
                        record.get(
                            "product_code",
                            "-"
                        )
                    )

                    item_id = make_unique_item_id(
                        record,
                        item_index,
                        used_item_ids
                    )

                    quantity = to_number(
                        record.get("sale_qty")
                    )

                    packaged = (
                        get_shared_packaging_status(
                            connection,
                            str(sale_id),
                            item_id,
                            product_code,
                            quantity
                        )
                    )

                    items.append({
                        "id": item_id,
                        "code": product_code,
                        "name": record.get(
                            "product_name",
                            "-"
                        ),
                        "qty": quantity,
                        "packaged": packaged
                    })

                result.append({
                    "id": str(sale_id),
                    "dealer": row[3],
                    "remark": row[5],
                    "date": row[8],
                    "link": link,
                    "items": items
                })

        return jsonify(result)

    except requests.RequestException as error:
        app.logger.exception(
            "SSE request failed"
        )

        return jsonify({
            "error": "Unable to retrieve approvals from SSE.",
            "details": str(error)
        }), 502

    except (
        KeyError,
        IndexError,
        TypeError,
        ValueError,
        json.JSONDecodeError
    ) as error:
        app.logger.exception(
            "Unexpected SSE response format"
        )

        return jsonify({
            "error": "Unexpected data returned by SSE.",
            "details": str(error)
        }), 502

    except sqlite3.Error as error:
        app.logger.exception(
            "Packaging database error"
        )

        return jsonify({
            "error": "Packaging status database error.",
            "details": str(error)
        }), 500


initialize_database()


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5000
    )