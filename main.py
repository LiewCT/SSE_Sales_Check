from flask import Flask, jsonify
from flask_cors import CORS
import requests
import json

app = Flask(__name__)

CORS(app)


@app.route("/approvals", methods=["GET"])
def approvals():

    session = requests.Session()

    session.cookies.set(
        "ci_session",
        "ulm4c23nss30k6c97rn1tif7s7rut4ic",
        domain="ssegroup.com.my"
    )

    payload = {
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


    headers = {
        "Authorization":
        "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyX25hbWUiOiJKb2pvMzMifQ.Y2m-K7E-uDfpqoBIN8fwZ7CfXgQfo57LYBulj8MOzDA",

        "Content-Type":
        "application/x-www-form-urlencoded; charset=UTF-8",

        "Accept":
        "application/json, text/javascript, */*; q=0.01",

        "Referer":
        "https://ssegroup.com.my/approvals",

        "X-Requested-With":
        "XMLHttpRequest",

        "User-Agent":
        "Mozilla/5.0"
    }


    response = session.post(
        "https://ssegroup.com.my/api/approvals/datatables",
        headers=headers,
        data=payload
    )


    data = response.json()

    result = []

    for row in data["data"]:

        link = row[9].split('href="')[1].split('"')[0]

        sale_id = link.rstrip("/").split("/")[-1]

        sale_response = session.get(
            f"https://ssegroup.com.my/api/sales/{sale_id}",
            headers=headers
        )

        sale_data = sale_response.json()

        records = sale_data["data"]["record"]["records"]

        items = []

        for record in records:
            items.append({
                "code": record["product_code"],
                "name": record["product_name"],
                "qty": record["sale_qty"]
            })


        result.append({
            "dealer": row[3],
            "remark": row[5],
            "date": row[8],
            "link": link,
            "items": items
        })
    return result
    


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5000
    )