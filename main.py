from concurrent.futures import ThreadPoolExecutor,as_completed
from datetime import datetime,timezone
import json,os,re,sqlite3,requests
from flask import Flask,jsonify,request
from flask_cors import CORS

app=Flask(__name__)
CORS(app)

SSE_CI_SESSION=os.environ.get("SSE_CI_SESSION","ulm4c23nss30k6c97rn1tif7s7rut4ic")
SSE_AUTHORIZATION=os.environ.get("SSE_AUTHORIZATION","eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyX25hbWUiOiJKb2pvMzMifQ.Y2m-K7E-uDfpqoBIN8fwZ7CfXgQfo57LYBulj8MOzDA")
DATABASE_PATH=os.environ.get("PACKAGING_DB_PATH",os.path.join(os.path.dirname(os.path.abspath(__file__)),"packaging_status.db"))
REQUEST_TIMEOUT_SECONDS=30
SSE_APPROVALS_DATATABLE_URL="https://ssegroup.com.my/api/approvals/datatables"
SSE_CREDITS_DATATABLE_URL="https://ssegroup.com.my/api/credits/datatables"
SSE_CREDIT_DETAIL_URL="https://ssegroup.com.my/api/credits"

def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()

def get_database_connection():
    directory=os.path.dirname(DATABASE_PATH)
    if directory:os.makedirs(directory,exist_ok=True)
    connection=sqlite3.connect(DATABASE_PATH,timeout=30)
    connection.row_factory=sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA busy_timeout=30000")
    return connection

def initialize_database():
    with get_database_connection() as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS packaging_status(
                order_id TEXT NOT NULL,
                item_id TEXT NOT NULL,
                product_code TEXT NOT NULL,
                packaged INTEGER NOT NULL DEFAULT 0,
                last_quantity REAL NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(order_id,item_id),
                CHECK(packaged IN(0,1))
            )
        """)

def build_sse_session():
    session=requests.Session()
    session.cookies.set("ci_session",SSE_CI_SESSION,domain="ssegroup.com.my",path="/")
    return session

def build_sse_headers(referer="https://ssegroup.com.my/approvals"):
    return {
        "Authorization":SSE_AUTHORIZATION,
        "Content-Type":"application/x-www-form-urlencoded; charset=UTF-8",
        "Accept":"application/json, text/javascript, */*; q=0.01",
        "Origin":"https://ssegroup.com.my",
        "Referer":referer,
        "X-Requested-With":"XMLHttpRequest",
        "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
    }

def parse_sse_json_response(response):
    if response.status_code==401:raise PermissionError("SSE authentication is unauthorized. Update SSE_CI_SESSION and SSE_AUTHORIZATION in Render.")
    if response.status_code==403:raise PermissionError("SSE rejected the request. Check SSE_CI_SESSION and SSE_AUTHORIZATION.")
    response.raise_for_status()
    try:return response.json()
    except ValueError as error:raise RuntimeError("SSE returned a non-JSON response.") from error

def build_approvals_payload():
    return {
        "draw":"1",
        "start":"0",
        "length":"100",
        "search[value]":json.dumps({
            "date_start":"",
            "date_end":"",
            "search":"",
            "sale_branch":1,
            "sale_status":{
                "Pending":True,
                "Approved":False,
                "Rejected":False,
                "Invoiced":False,
                "NotInvoiced":False,
                "PreOrder":True,
                "Reserved":False
            },
            "sale_dealer":"",
            "proforma_invoiced":False,
            "pro_forma_code":""
        }),
        "search[regex]":"false"
    }

def build_approved_payload():
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
                "Pending": False,
                "Approved": True,
                "Rejected": False,
                "Invoiced": False,
                "NotInvoiced": False,
                "PreOrder": False,
                "Reserved": False
            },
            "sale_dealer": "",
            "proforma_invoiced": False,
            "pro_forma_code": ""
        }),
        "search[regex]": "false"
    }

def build_credit_datatable_payload(length,date_start,date_end):
    payload={
        "draw":"5",
        "start":"0",
        "length":str(length),
        "search[value]":json.dumps({
            "search":"",
            "branch_id":"1",
            "credit_status":{"Valid":True,"Cancelled":True},
            "einvoice_status":{"submitted":True,"unsubmitted":True},
            "date_start":date_start,
            "date_end":date_end
        }),
        "search[regex]":"false"
    }
    for index in range(9):
        prefix=f"columns[{index}]"
        payload[f"{prefix}[data]"]=str(index)
        payload[f"{prefix}[name]"]=""
        payload[f"{prefix}[searchable]"]="true"
        payload[f"{prefix}[orderable]"]="true"
        payload[f"{prefix}[search][value]"]=""
        payload[f"{prefix}[search][regex]"]="false"
    return payload

def request_credit_datatable(length,date_start,date_end):
    response=build_sse_session().post(
        SSE_CREDITS_DATATABLE_URL,
        headers=build_sse_headers("https://ssegroup.com.my/credits"),
        data=build_credit_datatable_payload(length,date_start,date_end),
        timeout=REQUEST_TIMEOUT_SECONDS
    )
    return parse_sse_json_response(response)

def extract_credit_note_id(button_html):
    match=re.search(r"viewCredit\(\s*[\"']?(\d+)[\"']?\s*\)",str(button_html or ""),flags=re.IGNORECASE)
    return match.group(1) if match else ""

def request_credit_detail(credit_note_id,dealer_name,credit_group):
    response=build_sse_session().get(
        f"{SSE_CREDIT_DETAIL_URL}/{credit_note_id}",
        headers=build_sse_headers(f"https://ssegroup.com.my/credits/{credit_note_id}"),
        timeout=REQUEST_TIMEOUT_SECONDS
    )
    credit=parse_sse_json_response(response).get("data",{}).get("credit")
    if not isinstance(credit,dict):return []
    records=credit.get("records",[])
    if not isinstance(records,list):records=[]
    rows=[]
    for record in records:
        if not isinstance(record,dict):continue
        rows.append({
            "credit_group":credit_group,
            "dealer_name":dealer_name,
            "date":str(credit.get("created_at","-")),
            "product_code":str(record.get("product_code","-")),
            "product_name":str(record.get("product_name","-")),
            "product_description":str(record.get("product_description","-")),
            "refund_qty":str(record.get("refund_qty","0"))
        })
    return rows

def make_unique_item_id(record,item_index,used_item_ids):
    base=str(record.get("id") or record.get("sale_record_id") or record.get("record_id") or record.get("product_id") or record.get("product_code") or f"item-{item_index}")
    occurrence=used_item_ids.get(base,0)
    used_item_ids[base]=occurrence+1
    return base if occurrence==0 else f"{base}::{occurrence}"

def to_number(value):
    try:
        number=float(value)
        return int(number) if number.is_integer() else number
    except(TypeError,ValueError):return 0

def get_shared_packaging_status(connection,order_id,item_id,product_code,current_quantity):
    status=connection.execute("""
        SELECT packaged,last_quantity,product_code
        FROM packaging_status
        WHERE order_id=? AND item_id=?
    """,(order_id,item_id)).fetchone()
    now=utc_now_iso()
    if status is None:
        connection.execute("""
            INSERT INTO packaging_status(
                order_id,item_id,product_code,packaged,last_quantity,updated_at
            )VALUES(?,?,?,0,?,?)
        """,(order_id,item_id,product_code,current_quantity,now))
        return False
    packaged=bool(status["packaged"])
    previous_quantity=to_number(status["last_quantity"])
    quantity_increased=current_quantity>previous_quantity
    if quantity_increased:packaged=False
    if quantity_increased or current_quantity!=previous_quantity or product_code!=status["product_code"]:
        connection.execute("""
            UPDATE packaging_status
            SET product_code=?,packaged=?,last_quantity=?,updated_at=?
            WHERE order_id=? AND item_id=?
        """,(product_code,int(packaged),current_quantity,now,order_id,item_id))
    return packaged

@app.route("/health",methods=["GET"])
def health():
    return jsonify({"status":"ok"})

@app.route("/packaging-status",methods=["PUT"])
def update_packaging_status():
    body=request.get_json(silent=True)
    if not isinstance(body,dict):return jsonify({"error":"JSON body is required."}),400
    order_id=str(body.get("order_id","")).strip()
    item_id=str(body.get("item_id","")).strip()
    packaged=body.get("packaged")
    product_code=str(body.get("product_code",""))
    quantity=to_number(body.get("quantity"))
    if not order_id:return jsonify({"error":"order_id is required."}),400
    if not item_id:return jsonify({"error":"item_id is required."}),400
    if not isinstance(packaged,bool):return jsonify({"error":"packaged must be true or false."}),400

    with get_database_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        status=connection.execute("""
            SELECT product_code,last_quantity
            FROM packaging_status
            WHERE order_id=? AND item_id=?
        """,(order_id,item_id)).fetchone()
        if status is None:
            connection.execute("""
                INSERT INTO packaging_status(
                    order_id,item_id,product_code,packaged,last_quantity,updated_at
                )VALUES(?,?,?,?,?,?)
            """,(order_id,item_id,product_code,int(packaged),quantity,utc_now_iso()))
        else:
            connection.execute("""
                UPDATE packaging_status
                SET packaged=?,updated_at=?
                WHERE order_id=? AND item_id=?
            """,(int(packaged),utc_now_iso(),order_id,item_id))

    return jsonify({"order_id":order_id,"item_id":item_id,"packaged":packaged})

@app.route("/approvals",methods=["GET"])
def approvals():
    session=build_sse_session()
    headers=build_sse_headers()
    try:
        response=session.post(SSE_APPROVALS_DATATABLE_URL,headers=headers,data=build_approvals_payload(),timeout=REQUEST_TIMEOUT_SECONDS)
        response.raise_for_status()
        rows=response.json().get("data",[])
        result=[]

        with get_database_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            for row in rows:
                link=row[9].split('href="',1)[1].split('"',1)[0]
                sale_id=link.rstrip("/").split("/")[-1]
                sale_response=session.get(f"https://ssegroup.com.my/api/sales/{sale_id}",headers=headers,timeout=REQUEST_TIMEOUT_SECONDS)
                sale_response.raise_for_status()
                records=sale_response.json().get("data",{}).get("record",{}).get("records",[])
                items=[]
                used_item_ids={}

                for item_index,record in enumerate(records):
                    product_id=str(record.get("sale_product").strip())
                    product_code=str(record.get("product_code","-"))
                    product_name=str(record.get("product_name","-"))
                    product_description=str(record.get("prproduct_descriptionoduct_name","-"))
                    item_id=make_unique_item_id(record,item_index,used_item_ids)
                    quantity=to_number(record.get("sale_qty"))
                    packaged=get_shared_packaging_status(connection,str(sale_id),item_id,product_code,quantity)
                    items.append({
                        "id":item_id,
                        "product_id":product_id,
                        "code":product_code,
                        "name":product_name,
                        "product_description":product_description,
                        "qty":quantity,
                        "packaged":packaged
                    })

                result.append({
                    "id":str(sale_id),
                    "dealer":row[3],
                    "remark":row[5],
                    "date":row[8],
                    "link":link,
                    "items":items
                })

        return jsonify(result)

    except requests.RequestException as error:
        app.logger.exception("SSE request failed")
        return jsonify({"error":"Unable to retrieve approvals from SSE.","details":str(error)}),502
    except(KeyError,IndexError,TypeError,ValueError,json.JSONDecodeError) as error:
        app.logger.exception("Unexpected SSE response format")
        return jsonify({"error":"Unexpected data returned by SSE.","details":str(error)}),502
    except sqlite3.Error as error:
        app.logger.exception("Packaging database error")
        return jsonify({"error":"Packaging status database error.","details":str(error)}),500

@app.route("/approve-order",methods=["POST"])
def approve_order():
    body=request.get_json(silent=True)
    if not isinstance(body,dict):return jsonify({"error":"JSON body is required."}),400
    sale_id=str(body.get("sale_id","")).strip()
    selected_items=body.get("selected_items")
    sale_remark=str(body.get("sale_remark",""))
    if not sale_id:return jsonify({"error":"sale_id is required."}),400
    if not isinstance(selected_items,list):return jsonify({"error":"selected_items must be an array."}),400
    selected_items=[str(product_id).strip() for product_id in selected_items if str(product_id).strip()]
    if not selected_items:return jsonify({"error":"selected_items cannot be empty."}),400

    session=build_sse_session()
    headers=build_sse_headers(f"https://ssegroup.com.my/approvals/{sale_id}")
    headers.update({"Content-Type":"application/json","Accept":"application/json, text/plain, */*"})
    payload={"sale_id":sale_id,"selected_items":selected_items,"sale_remark":sale_remark}

    try:
        response=session.post(
            f"https://ssegroup.com.my/api/sales/{sale_id}/approve-selected",
            headers=headers,
            json=payload,
            timeout=REQUEST_TIMEOUT_SECONDS
        )
        response.raise_for_status()
        try:response_data=response.json()
        except ValueError:response_data={"status":response.ok,"message":response.text or "Approval request completed."}
        return jsonify(response_data),response.status_code
    except requests.RequestException as error:
        app.logger.exception("SSE approval request failed")
        return jsonify({"error":"Unable to approve the SSE order.","details":str(error)}),502

@app.route("/credit-note-report",methods=["POST"])
def credit_note_report():
    body=request.get_json(silent=True)
    if not isinstance(body,dict):return jsonify({"error":"JSON body is required."}),400
    date_start=str(body.get("date_start","")).strip()
    date_end=str(body.get("date_end","")).strip()
    if not date_start or not date_end:return jsonify({"error":"date_start and date_end are required."}),400
    if date_start>date_end:return jsonify({"error":"date_start cannot be later than date_end."}),400
    if not SSE_CI_SESSION:return jsonify({"error":"SSE_CI_SESSION is not configured."}),500
    if not SSE_AUTHORIZATION:return jsonify({"error":"SSE_AUTHORIZATION is not configured."}),500

    def normalize_credit_remark(value):
        text=str(value or "")
        text=re.sub(r"<[^>]*>"," ",text)
        text=text.replace("&nbsp;"," ").replace("&#160;"," ").replace("\xa0"," ")
        text=re.sub(r"[\u200B-\u200D\uFEFF]","",text)
        return re.sub(r"[^A-Z0-9]+","",text.upper())

    category_labels={"no_problem_cn":"No Problem CN","problem_cn":"Problem CN","others":"Others"}
    empty_counts={key:0 for key in category_labels}

    try:
        first_response=request_credit_datatable(1,date_start,date_end)
        records_filtered=int(first_response.get("recordsFiltered",0))

        if records_filtered<=0:
            return jsonify({"status":True,"records_filtered":0,"matched_credit_notes":0,"report_rows":0,"category_counts":empty_counts.copy(),"category_report_rows":empty_counts.copy(),"data":[]})

        second_response=request_credit_datatable(records_filtered,date_start,date_end)
        datatable_rows=second_response.get("data",[])
        if not isinstance(datatable_rows,list):datatable_rows=[]

        credit_notes=[]
        used_credit_note_ids=set()
        category_counts=empty_counts.copy()

        for row in datatable_rows:
            if not isinstance(row,list) or len(row)<9:continue

            remark=str(row[5] or "").strip()
            normalized_remark=normalize_credit_remark(remark)

            if normalized_remark=="NOPROBLEMCN":category="no_problem_cn"
            elif normalized_remark=="PROBLEMCN":category="problem_cn"
            else:category="others"

            credit_note_id=extract_credit_note_id(row[8])
            if not credit_note_id or credit_note_id in used_credit_note_ids:continue

            used_credit_note_ids.add(credit_note_id)
            dealer_name=str(row[3] or "-").strip() or "-"

            credit_notes.append({
                "credit_note_id":credit_note_id,
                "dealer_name":dealer_name,
                "credit_group":len(credit_notes),
                "credit_category":category,
                "credit_category_label":category_labels[category],
                "remark":remark or "-",
                "credit_remark":remark or "-",
                "credit_remark_normalized":normalized_remark
            })

            category_counts[category]+=1

        if not credit_notes:
            return jsonify({"status":True,"records_filtered":records_filtered,"matched_credit_notes":0,"report_rows":0,"category_counts":category_counts,"category_report_rows":empty_counts.copy(),"data":[]})

        credit_detail_results={}

        with ThreadPoolExecutor(max_workers=6) as executor:
            future_map={
                executor.submit(
                    request_credit_detail,
                    note["credit_note_id"],
                    note["dealer_name"],
                    note["credit_group"]
                ):note
                for note in credit_notes
            }

            for future in as_completed(future_map):
                note=future_map[future]
                credit_note_id=note["credit_note_id"]

                try:
                    rows=future.result()
                    if not isinstance(rows,list):rows=[]

                    for detail in rows:
                        if not isinstance(detail,dict):continue
                        detail.update({
                            "credit_note_id":credit_note_id,
                            "credit_category":note["credit_category"],
                            "credit_category_label":note["credit_category_label"],
                            "remark":note["remark"],
                            "credit_remark":note["credit_remark"],
                            "credit_remark_normalized":note["credit_remark_normalized"]
                        })

                    credit_detail_results[credit_note_id]=rows

                except PermissionError:
                    raise

                except requests.RequestException as error:
                    app.logger.error("Cannot retrieve credit note %s: %s",credit_note_id,error)
                    credit_detail_results[credit_note_id]=[]

                except(TypeError,ValueError,RuntimeError) as error:
                    app.logger.error("Invalid credit note response %s: %s",credit_note_id,error)
                    credit_detail_results[credit_note_id]=[]

        report_rows=[]
        category_report_rows=empty_counts.copy()

        for note in credit_notes:
            rows=credit_detail_results.get(note["credit_note_id"],[])
            report_rows.extend(rows)
            category_report_rows[note["credit_category"]]+=len(rows)

        return jsonify({
            "status":True,
            "records_filtered":records_filtered,
            "matched_credit_notes":len(credit_notes),
            "report_rows":len(report_rows),
            "category_counts":category_counts,
            "category_report_rows":category_report_rows,
            "data":report_rows
        })

    except PermissionError as error:
        app.logger.exception("SSE credit authentication failed")
        return jsonify({"error":str(error)}),401

    except requests.RequestException as error:
        app.logger.exception("SSE credit request failed")
        return jsonify({"error":"Unable to request the SSE credit API.","details":str(error)}),502

    except(TypeError,ValueError,RuntimeError,json.JSONDecodeError) as error:
        app.logger.exception("Unexpected SSE credit response")
        return jsonify({"error":"Unexpected data returned by the SSE credit API.","details":str(error)}),502

    except Exception as error:
        app.logger.exception("Credit Note Report failed")
        return jsonify({"error":"Unable to generate the Credits Note Report.","details":str(error)}),500

@app.route(
    "/open-invoices",
    methods=["GET"]
)
def open_invoices():
    session = build_sse_session()
    headers = build_sse_headers()

    try:
        response = session.post(
            SSE_APPROVALS_DATATABLE_URL,
            headers=headers,
            data=build_approved_payload(),
            timeout=REQUEST_TIMEOUT_SECONDS
        )

        response.raise_for_status()
        rows = response.json().get("data", [])
        result = []

        with get_database_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")

            for row in rows:
                link = row[9].split('href="', 1)[1].split('"', 1)[0]
                sale_id = link.rstrip("/").split("/")[-1]
                sale_response = session.get(
                    f"https://ssegroup.com.my/api/sales/{sale_id}",
                    headers=headers,
                    timeout=REQUEST_TIMEOUT_SECONDS
                )
                sale_response.raise_for_status()
                records = sale_response.json().get("data", {}).get("record", {}).get("records", [])
                items = []
                used_item_ids = {}

                for item_index, record in enumerate(records):
                    product_id = str(record.get("sale_product") or "").strip()
                    product_code = str(record.get("product_code", "-"))
                    product_name = str(record.get("product_name", "-"))
                    product_description = str(record.get("product_description") or product_name or "-")
                    item_id = make_unique_item_id(record, item_index, used_item_ids)
                    quantity = to_number(record.get("sale_qty"))
                    packaged = get_shared_packaging_status(connection, str(sale_id), item_id, product_code, quantity)
                    items.append({
                        "id": item_id,
                        "product_id": product_id,
                        "code": product_code,
                        "name": product_name,
                        "product_description": product_description,
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
        app.logger.exception("SSE approved-order request failed")
        return jsonify({"error": "Unable to retrieve approved orders from SSE.", "details": str(error)}), 502
    except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as error:
        app.logger.exception("Unexpected approved-order response format")
        return jsonify({"error": "Unexpected approved-order data returned by SSE.", "details": str(error)}), 502
    except sqlite3.Error as error:
        app.logger.exception("Packaging database error")
        return jsonify({"error": "Packaging status database error.", "details": str(error)}), 500



initialize_database()

if __name__=="__main__":
    app.run(host="0.0.0.0",port=5000)