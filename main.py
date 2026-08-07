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
SSE_SALES_URL="https://ssegroup.com.my/api/sales"
NINE_TECH_PATTERN=re.compile(r"\b9[\s_-]*tech\b",re.IGNORECASE)

def utc_now_iso():return datetime.now(timezone.utc).isoformat()

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
                packed_quantity REAL NOT NULL DEFAULT 0,
                last_quantity REAL NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(order_id,item_id),
                CHECK(packaged IN(0,1))
            )
        """)
        columns={row["name"] for row in connection.execute("PRAGMA table_info(packaging_status)").fetchall()}
        if "packed_quantity" not in columns:
            connection.execute("ALTER TABLE packaging_status ADD COLUMN packed_quantity REAL NOT NULL DEFAULT 0")
            connection.execute("UPDATE packaging_status SET packed_quantity=CASE WHEN packaged=1 THEN last_quantity ELSE 0 END")

def build_sse_session():
    session=requests.Session()
    session.cookies.set("ci_session",SSE_CI_SESSION,domain="ssegroup.com.my",path="/")
    return session

def build_sse_headers(referer="https://ssegroup.com.my/approvals"):
    return {"Authorization":SSE_AUTHORIZATION,"Content-Type":"application/x-www-form-urlencoded; charset=UTF-8","Accept":"application/json, text/javascript, */*; q=0.01","Origin":"https://ssegroup.com.my","Referer":referer,"X-Requested-With":"XMLHttpRequest","User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"}

def parse_sse_json_response(response):
    if response.status_code==401:raise PermissionError("SSE authentication is unauthorized. Update SSE_CI_SESSION and SSE_AUTHORIZATION in Render.")
    if response.status_code==403:raise PermissionError("SSE rejected the request. Check SSE_CI_SESSION and SSE_AUTHORIZATION.")
    response.raise_for_status()
    try:return response.json()
    except ValueError as error:raise RuntimeError("SSE returned a non-JSON response.") from error

def build_approvals_payload():
    return {"draw":"1","start":"0","length":"100","search[value]":json.dumps({"date_start":"","date_end":"","search":"","sale_branch":1,"sale_status":{"Pending":True,"Approved":False,"Rejected":False,"Invoiced":False,"NotInvoiced":False,"PreOrder":False,"Reserved":False},"sale_dealer":"","proforma_invoiced":False,"pro_forma_code":""}),"search[regex]":"false"}

def build_approved_payload(date_start="",date_end=""):
    return {"draw":"1","start":"0","length":"100","search[value]":json.dumps({"date_start":date_start,"date_end":date_end,"search":"","sale_branch":1,"sale_status":{"Pending":False,"Approved":True,"Rejected":False,"Invoiced":False,"NotInvoiced":False,"PreOrder":False,"Reserved":False},"sale_dealer":"","proforma_invoiced":False,"pro_forma_code":""}),"search[regex]":"false"}

def build_credit_datatable_payload(length,date_start,date_end):
    payload={"draw":"5","start":"0","length":str(length),"search[value]":json.dumps({"search":"","branch_id":"1","credit_status":{"Valid":True,"Cancelled":True},"einvoice_status":{"submitted":True,"unsubmitted":True},"date_start":date_start,"date_end":date_end}),"search[regex]":"false"}
    for index in range(9):
        prefix=f"columns[{index}]"
        payload.update({f"{prefix}[data]":str(index),f"{prefix}[name]":"",f"{prefix}[searchable]":"true",f"{prefix}[orderable]":"true",f"{prefix}[search][value]":"",f"{prefix}[search][regex]":"false"})
    return payload

def request_credit_datatable(length,date_start,date_end):
    response=build_sse_session().post(SSE_CREDITS_DATATABLE_URL,headers=build_sse_headers("https://ssegroup.com.my/credits"),data=build_credit_datatable_payload(length,date_start,date_end),timeout=REQUEST_TIMEOUT_SECONDS)
    return parse_sse_json_response(response)

def extract_credit_note_id(button_html):
    match=re.search(r"viewCredit\(\s*[\"']?(\d+)[\"']?\s*\)",str(button_html or ""),flags=re.IGNORECASE)
    return match.group(1) if match else ""

def request_credit_detail(credit_note_id,dealer_name,credit_group):
    response=build_sse_session().get(f"{SSE_CREDIT_DETAIL_URL}/{credit_note_id}",headers=build_sse_headers(f"https://ssegroup.com.my/credits/{credit_note_id}"),timeout=REQUEST_TIMEOUT_SECONDS)
    credit=parse_sse_json_response(response).get("data",{}).get("credit")
    if not isinstance(credit,dict):return []
    records=credit.get("records",[])
    if not isinstance(records,list):records=[]
    rows=[]
    for record in records:
        if not isinstance(record,dict):continue
        rows.append({"credit_group":credit_group,"dealer_name":dealer_name,"date":str(credit.get("created_at","-")),"product_code":str(record.get("product_code","-")),"product_name":str(record.get("product_name","-")),"product_description":str(record.get("product_description","-")),"refund_qty":str(record.get("refund_qty","0"))})
    return rows

def make_unique_item_id(record,item_index,used_item_ids):
    base=str(record.get("id") or record.get("sale_record_id") or record.get("record_id") or record.get("product_id") or record.get("product_code") or f"item-{item_index}")
    occurrence=used_item_ids.get(base,0)
    used_item_ids[base]=occurrence+1
    return base if occurrence==0 else f"{base}::{occurrence}"

def normalize_top_remark(value):
    if value is None:return ""
    if isinstance(value,(list,tuple)):
        for item in value:
            remark=normalize_top_remark(item)
            if remark:return remark
        return ""
    if isinstance(value,dict):
        for key in("remark","sale_remark","name","value"):
            if key in value:
                remark=normalize_top_remark(value.get(key))
                if remark:return remark
        return ""
    text=str(value).strip()
    if not text:return ""
    try:
        decoded=json.loads(text)
        if isinstance(decoded,(list,dict)):return normalize_top_remark(decoded)
    except(ValueError,TypeError,json.JSONDecodeError):pass
    text=re.sub(r"<br\s*/?>","\n",text,flags=re.IGNORECASE)
    lines=[re.sub(r"<[^>]*>","",line).strip() for line in text.splitlines()]
    return next((line for line in lines if line),"")

def extract_sale_record(payload):
    data=payload.get("data",{}) if isinstance(payload,dict) else {}
    if not isinstance(data,dict):return {}
    for key in("record","sale"):
        candidate=data.get(key)
        if isinstance(candidate,dict):return candidate
    return data

def request_sale(session,sale_id,headers):
    response=session.get(f"{SSE_SALES_URL}/{sale_id}",headers=headers,timeout=REQUEST_TIMEOUT_SECONDS)
    sale=extract_sale_record(parse_sse_json_response(response))
    records=sale.get("records",[]) if isinstance(sale,dict) else []
    return sale,records if isinstance(records,list) else []

def normalize_identity(value):return re.sub(r"\s+"," ",str(value or "").strip().lower())

def extract_dealer_identity(sale):
    if not isinstance(sale,dict):return ""
    for key in("dealer","sale_dealer_detail","customer"):
        nested=sale.get(key)
        if isinstance(nested,dict):
            for nested_key in("id","dealer_id","sale_dealer_id","customer_id","code","name"):
                value=nested.get(nested_key)
                if value not in(None,""):return normalize_identity(value)
    for key in("dealer_id","sale_dealer_id","sale_dealer","customer_id","dealer_code","dealer_name"):
        value=sale.get(key)
        if isinstance(value,dict):
            nested=extract_dealer_identity({"dealer":value})
            if nested:return nested
        elif value not in(None,""):return normalize_identity(value)
    return ""

def request_pending_order_metadata(session,headers):
    response=session.post(SSE_APPROVALS_DATATABLE_URL,headers=headers,data=build_approvals_payload(),timeout=REQUEST_TIMEOUT_SECONDS)
    rows=parse_sse_json_response(response).get("data",[])
    metadata={}
    for row in rows if isinstance(rows,list) else []:
        try:
            link=str(row[10]).split('href="',1)[1].split('"',1)[0]
            sale_id=link.rstrip("/").split("/")[-1]
            metadata[str(sale_id)]={"dealer":str(row[3] or "").strip(),"remark":normalize_top_remark(row[5])}
        except(IndexError,TypeError,AttributeError):continue
    return metadata

def prepare_order_items(records):
    items=[]
    used_item_ids={}
    for item_index,record in enumerate(records if isinstance(records,list) else []):
        if not isinstance(record,dict):continue
        product_id=str(record.get("sale_product") or record.get("product_id") or "").strip()
        product_code=str(record.get("product_code","-"))
        product_name=str(record.get("product_name","-"))
        product_description=str(record.get("product_description") or product_name or "-")
        items.append({"id":make_unique_item_id(record,item_index,used_item_ids),"product_id":product_id,"code":product_code,"name":product_name,"product_description":product_description,"qty":max(to_number(record.get("sale_qty")),0)})
    return items

def product_key(item):
    product_id=normalize_identity(item.get("product_id"))
    return f"id:{product_id}" if product_id else f"code:{normalize_identity(item.get('code'))}"

def is_nine_tech_item(item):return bool(NINE_TECH_PATTERN.search(f"{item.get('code','')} {item.get('name','')} {item.get('product_description','')}"))

def get_order_product_group(items):
    positive_items=[item for item in items if to_number(item.get("qty"))>0]
    if not positive_items:return "empty"
    nine_tech_count=sum(1 for item in positive_items if is_nine_tech_item(item))
    if nine_tech_count==len(positive_items):return "nine_tech"
    if nine_tech_count==0:return "normal"
    return "mixed"

def to_number(value):
    try:
        number=float(value)
        return int(number) if number.is_integer() else number
    except(TypeError,ValueError):return 0

def clamp_packed_quantity(value,quantity):return min(max(to_number(value),0),max(to_number(quantity),0))

def get_shared_packaging_status(connection,order_id,item_id,product_code,current_quantity):
    current_quantity=max(to_number(current_quantity),0)
    status=connection.execute("SELECT packaged,packed_quantity,last_quantity,product_code FROM packaging_status WHERE order_id=? AND item_id=?",(order_id,item_id)).fetchone()
    now=utc_now_iso()
    if status is None:
        connection.execute("INSERT INTO packaging_status(order_id,item_id,product_code,packaged,packed_quantity,last_quantity,updated_at)VALUES(?,?,?,0,0,?,?)",(order_id,item_id,product_code,current_quantity,now))
        return {"packed_quantity":0,"packaged":False}
    previous_quantity=max(to_number(status["last_quantity"]),0)
    packed_quantity=clamp_packed_quantity(status["packed_quantity"],current_quantity)
    if current_quantity>previous_quantity:packed_quantity=0
    packaged=current_quantity>0 and packed_quantity>=current_quantity
    if current_quantity!=previous_quantity or product_code!=status["product_code"] or packed_quantity!=to_number(status["packed_quantity"]) or int(packaged)!=int(status["packaged"]):
        connection.execute("UPDATE packaging_status SET product_code=?,packaged=?,packed_quantity=?,last_quantity=?,updated_at=? WHERE order_id=? AND item_id=?",(product_code,int(packaged),packed_quantity,current_quantity,now,order_id,item_id))
    return {"packed_quantity":packed_quantity,"packaged":packaged}

def build_order_items(connection,sale_id,records):
    items=[]
    for item in prepare_order_items(records):
        packaging=get_shared_packaging_status(connection,str(sale_id),item["id"],item["code"],item["qty"])
        items.append({**item,"packed_quantity":packaging["packed_quantity"],"packaged":packaging["packaged"]})
    return items

def read_packaging_snapshot(connection,order_id,items):
    snapshot={}
    for item in items:
        row=connection.execute("SELECT packed_quantity FROM packaging_status WHERE order_id=? AND item_id=?",(str(order_id),str(item["id"]))).fetchone()
        snapshot[item["id"]]=clamp_packed_quantity(row["packed_quantity"] if row else 0,item["qty"])
    return snapshot

def upsert_packaging_status(connection,order_id,item,packed_quantity):
    quantity=max(to_number(item["qty"]),0)
    packed_quantity=clamp_packed_quantity(packed_quantity,quantity)
    packaged=quantity>0 and packed_quantity>=quantity
    connection.execute("""
        INSERT INTO packaging_status(order_id,item_id,product_code,packaged,packed_quantity,last_quantity,updated_at)
        VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(order_id,item_id) DO UPDATE SET
            product_code=excluded.product_code,packaged=excluded.packaged,packed_quantity=excluded.packed_quantity,last_quantity=excluded.last_quantity,updated_at=excluded.updated_at
    """,(str(order_id),str(item["id"]),str(item["code"]),int(packaged),packed_quantity,quantity,utc_now_iso()))

def transfer_combined_packaging(connection,source_sale_id,target_sale_id,source_items,target_items_before,target_items_after,source_snapshot,target_snapshot):
    source_groups={}
    before_groups={}
    after_groups={}
    for item in source_items:source_groups.setdefault(product_key(item),[]).append(item)
    for item in target_items_before:before_groups.setdefault(product_key(item),[]).append(item)
    for item in target_items_after:after_groups.setdefault(product_key(item),[]).append(item)
    for key,moved_items in source_groups.items():
        after_items=after_groups.get(key,[])
        if not after_items:raise RuntimeError(f"Unable to match added product {moved_items[0]['code']} in target order.")
        previous_items=before_groups.get(key,[])
        desired_total=sum(source_snapshot.get(item["id"],0) for item in moved_items)+sum(target_snapshot.get(item["id"],0) for item in previous_items)
        allocations={}
        for item in after_items:
            allocations[item["id"]]=clamp_packed_quantity(target_snapshot.get(item["id"],0),item["qty"])
        remaining=max(0,desired_total-sum(allocations.values()))
        for item in after_items:
            if remaining<=0:break
            capacity=max(0,to_number(item["qty"])-allocations[item["id"]])
            addition=min(capacity,remaining)
            allocations[item["id"]]+=addition
            remaining-=addition
        if remaining>0:raise RuntimeError(f"Packaging quantity exceeds target quantity for product {moved_items[0]['code']}.")
        for item in after_items:upsert_packaging_status(connection,target_sale_id,item,allocations[item["id"]])
    after_ids=[str(item["id"]) for item in target_items_after]
    if after_ids:
        placeholders=",".join("?" for _ in after_ids)
        connection.execute(f"DELETE FROM packaging_status WHERE order_id=? AND item_id NOT IN({placeholders})",[str(target_sale_id),*after_ids])
    else:connection.execute("DELETE FROM packaging_status WHERE order_id=?",(str(target_sale_id),))

def api_quantity(value):
    number=to_number(value)
    return str(int(number)) if isinstance(number,(int,float)) and float(number).is_integer() else str(number)

def response_status_is_success(data):
    if not isinstance(data,dict):return False
    return data.get("status") in(True,1,"1","true","True")

@app.route("/health",methods=["GET"])
def health():return jsonify({"status":"ok"})

@app.route("/packaging-status",methods=["PUT"])
def update_packaging_status():
    body=request.get_json(silent=True)
    if not isinstance(body,dict):return jsonify({"error":"JSON body is required."}),400
    order_id=str(body.get("order_id","")).strip()
    item_id=str(body.get("item_id","")).strip()
    product_code=str(body.get("product_code",""))
    quantity=max(to_number(body.get("quantity")),0)
    action=str(body.get("action","")).strip().lower()
    if not order_id:return jsonify({"error":"order_id is required."}),400
    if not item_id:return jsonify({"error":"item_id is required."}),400
    if action not in("","step"):return jsonify({"error":"action must be step."}),400
    with get_database_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        status=connection.execute("SELECT packed_quantity,last_quantity FROM packaging_status WHERE order_id=? AND item_id=?",(order_id,item_id)).fetchone()
        current_packed_quantity=clamp_packed_quantity(status["packed_quantity"] if status else 0,quantity)
        if status and quantity>max(to_number(status["last_quantity"]),0):current_packed_quantity=0
        if action=="step":packed_quantity=0 if quantity>0 and current_packed_quantity>=quantity else min(quantity,current_packed_quantity+1)
        elif "packed_quantity" in body:
            try:packed_quantity=float(body.get("packed_quantity"))
            except(TypeError,ValueError):return jsonify({"error":"packed_quantity must be a number."}),400
        else:
            packaged=body.get("packaged")
            if not isinstance(packaged,bool):return jsonify({"error":"packed_quantity, packaged or action is required."}),400
            packed_quantity=quantity if packaged else 0
        packed_quantity=clamp_packed_quantity(packed_quantity,quantity)
        packaged=quantity>0 and packed_quantity>=quantity
        if status is None:
            connection.execute("INSERT INTO packaging_status(order_id,item_id,product_code,packaged,packed_quantity,last_quantity,updated_at)VALUES(?,?,?,?,?,?,?)",(order_id,item_id,product_code,int(packaged),packed_quantity,quantity,utc_now_iso()))
        else:
            connection.execute("UPDATE packaging_status SET product_code=?,packaged=?,packed_quantity=?,last_quantity=?,updated_at=? WHERE order_id=? AND item_id=?",(product_code,int(packaged),packed_quantity,quantity,utc_now_iso(),order_id,item_id))
    return jsonify({"order_id":order_id,"item_id":item_id,"quantity":quantity,"packed_quantity":packed_quantity,"packaged":packaged})

@app.route("/approvals",methods=["GET"])
def approvals():
    session=build_sse_session()
    headers=build_sse_headers()
    try:
        response=session.post(SSE_APPROVALS_DATATABLE_URL,headers=headers,data=build_approvals_payload(),timeout=REQUEST_TIMEOUT_SECONDS)
        rows=parse_sse_json_response(response).get("data",[])
        result=[]
        with get_database_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            for row in rows:
                link=row[9].split('href="',1)[1].split('"',1)[0]
                sale_id=link.rstrip("/").split("/")[-1]
                sale,records=request_sale(session,sale_id,headers)
                result.append({"id":str(sale_id),"dealer_id":extract_dealer_identity(sale) or normalize_identity(row[3]),"dealer":row[3],"remark":normalize_top_remark(row[5]),"date":row[8],"link":link,"items":build_order_items(connection,sale_id,records)})
        return jsonify(result)
    except requests.RequestException as error:
        app.logger.exception("SSE request failed")
        return jsonify({"error":"Unable to retrieve approvals from SSE.","details":str(error)}),502
    except(KeyError,IndexError,TypeError,ValueError,RuntimeError,json.JSONDecodeError) as error:
        app.logger.exception("Unexpected SSE response format")
        return jsonify({"error":"Unexpected data returned by SSE.","details":str(error)}),502
    except sqlite3.Error as error:
        app.logger.exception("Packaging database error")
        return jsonify({"error":"Packaging status database error.","details":str(error)}),500

@app.route("/combine-orders",methods=["POST"])
def combine_orders():
    body=request.get_json(silent=True)
    if not isinstance(body,dict):return jsonify({"error":"JSON body is required."}),400
    source_sale_id=str(body.get("source_sale_id","")).strip()
    target_sale_id=str(body.get("target_sale_id","")).strip()
    if not source_sale_id:return jsonify({"error":"source_sale_id is required."}),400
    if not target_sale_id:return jsonify({"error":"target_sale_id is required."}),400
    if source_sale_id==target_sale_id:return jsonify({"error":"An order cannot be combined into itself."}),400
    session=build_sse_session()
    headers=build_sse_headers(f"https://ssegroup.com.my/approvals/{target_sale_id}")
    json_headers={**headers,"Content-Type":"application/json","Accept":"application/json, text/plain, */*"}
    completed_items=0
    try:
        metadata=request_pending_order_metadata(session,headers)
        source_sale,source_records=request_sale(session,source_sale_id,headers)
        target_sale,target_records_before=request_sale(session,target_sale_id,headers)
        source_items=prepare_order_items(source_records)
        target_items_before=prepare_order_items(target_records_before)
        source_dealer=extract_dealer_identity(source_sale) or normalize_identity(metadata.get(source_sale_id,{}).get("dealer"))
        target_dealer=extract_dealer_identity(target_sale) or normalize_identity(metadata.get(target_sale_id,{}).get("dealer"))
        if not source_dealer or not target_dealer:return jsonify({"error":"Unable to verify both dealer IDs. The orders were not changed."}),409
        if source_dealer!=target_dealer:return jsonify({"error":"Orders from different dealers cannot be combined."}),409
        source_group=get_order_product_group(source_items)
        target_group=get_order_product_group(target_items_before)
        if source_group=="empty":return jsonify({"error":"The dragging order has no products."}),400
        if source_group=="mixed" or target_group=="mixed":return jsonify({"error":"An order containing mixed 9 Tech and normal products cannot be combined."}),409
        if source_group!=target_group:return jsonify({"error":"9 Tech products cannot be combined with normal products."}),409
        invalid_items=[item for item in source_items if not item["product_id"] or to_number(item["qty"])<=0]
        if invalid_items:return jsonify({"error":"One or more source products have no valid product ID or quantity.","products":[item["code"] for item in invalid_items]}),400
        with get_database_connection() as connection:
            source_snapshot=read_packaging_snapshot(connection,source_sale_id,source_items)
            target_snapshot=read_packaging_snapshot(connection,target_sale_id,target_items_before)
        post_responses=[]
        for item in source_items:
            payload={"product_id":str(item["product_id"]),"sale_remark":"","sale_qty":api_quantity(item["qty"])}
            response=session.post(f"{SSE_SALES_URL}/{target_sale_id}/records",headers=json_headers,json=payload,timeout=REQUEST_TIMEOUT_SECONDS)
            data=parse_sse_json_response(response)
            if not response_status_is_success(data):
                return jsonify({"error":data.get("message") or f"Unable to add product {item['code']} to target order.","completed_items":completed_items,"source_removed":False,"target_updated":completed_items>0}),502
            completed_items+=1
            post_responses.append({"product_id":item["product_id"],"quantity":item["qty"],"response":data})
        _,target_records_after=request_sale(session,target_sale_id,headers)
        target_items_after=prepare_order_items(target_records_after)
        with get_database_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            transfer_combined_packaging(connection,source_sale_id,target_sale_id,source_items,target_items_before,target_items_after,source_snapshot,target_snapshot)
        reject_response=session.put(f"{SSE_SALES_URL}/{source_sale_id}/reject-with-proforma",headers=json_headers,json={},timeout=REQUEST_TIMEOUT_SECONDS)
        reject_data=parse_sse_json_response(reject_response)
        if not response_status_is_success(reject_data):
            return jsonify({"error":reject_data.get("message") or "Products were added, but the source order could not be removed.","completed_items":completed_items,"source_removed":False,"target_updated":True}),502
        with get_database_connection() as connection:
            connection.execute("DELETE FROM packaging_status WHERE order_id=?",(source_sale_id,))
        return jsonify({"status":True,"message":"Orders combined successfully.","source_sale_id":source_sale_id,"target_sale_id":target_sale_id,"dealer_id":source_dealer,"source_remark":metadata.get(source_sale_id,{}).get("remark","") or normalize_top_remark(source_sale.get("sale_remark")),"items_added":completed_items,"source_removed":True,"packaging_status_preserved":True,"post_responses":post_responses})
    except PermissionError as error:
        return jsonify({"error":str(error),"completed_items":completed_items,"source_removed":False}),401
    except requests.RequestException as error:
        app.logger.exception("SSE combine-order request failed")
        return jsonify({"error":"Unable to complete the SSE combine request.","details":str(error),"completed_items":completed_items,"source_removed":False,"target_updated":completed_items>0}),502
    except(sqlite3.Error,RuntimeError,KeyError,TypeError,ValueError,json.JSONDecodeError) as error:
        app.logger.exception("Combine order failed")
        return jsonify({"error":"Unable to safely combine the orders.","details":str(error),"completed_items":completed_items,"source_removed":False,"target_updated":completed_items>0}),500

@app.route("/remove-order",methods=["POST"])
def remove_order():
    body=request.get_json(silent=True)
    if not isinstance(body,dict):return jsonify({"error":"JSON body is required."}),400
    sale_id=str(body.get("sale_id","")).strip()
    if not sale_id:return jsonify({"error":"sale_id is required."}),400
    session=build_sse_session()
    headers=build_sse_headers(f"https://ssegroup.com.my/approvals/{sale_id}")
    json_headers={**headers,"Content-Type":"application/json","Accept":"application/json, text/plain, */*"}
    try:
        response=session.put(f"{SSE_SALES_URL}/{sale_id}/reject-with-proforma",headers=json_headers,json={},timeout=REQUEST_TIMEOUT_SECONDS)
        data=parse_sse_json_response(response)
        if not response_status_is_success(data):return jsonify({"error":data.get("message") or "The order could not be removed."}),502
        with get_database_connection() as connection:connection.execute("DELETE FROM packaging_status WHERE order_id=?",(sale_id,))
        return jsonify({"status":True,"message":"Order removed successfully.","sale_id":sale_id})
    except PermissionError as error:
        return jsonify({"error":str(error)}),401
    except requests.RequestException as error:
        app.logger.exception("SSE remove-order request failed")
        return jsonify({"error":"Unable to remove the SSE order.","details":str(error)}),502
    except(sqlite3.Error,RuntimeError,KeyError,TypeError,ValueError,json.JSONDecodeError) as error:
        app.logger.exception("Remove order failed")
        return jsonify({"error":"Unable to safely remove the order.","details":str(error)}),500

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
    try:
        response=session.post(f"https://ssegroup.com.my/api/sales/{sale_id}/approve-selected",headers=headers,json={"sale_id":sale_id,"selected_items":selected_items,"sale_remark":sale_remark},timeout=REQUEST_TIMEOUT_SECONDS)
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
        text=re.sub(r"<[^>]*>"," ",str(value or ""))
        text=text.replace("&nbsp;"," ").replace("&#160;"," ").replace("\xa0"," ")
        text=re.sub(r"[\u200B-\u200D\uFEFF]","",text)
        return re.sub(r"[^A-Z0-9]+","",text.upper())
    category_labels={"no_problem_cn":"No Problem CN","problem_cn":"Problem CN","others":"Others"}
    empty_counts={key:0 for key in category_labels}
    try:
        first_response=request_credit_datatable(1,date_start,date_end)
        records_filtered=int(first_response.get("recordsFiltered",0))
        if records_filtered<=0:return jsonify({"status":True,"records_filtered":0,"matched_credit_notes":0,"report_rows":0,"category_counts":empty_counts.copy(),"category_report_rows":empty_counts.copy(),"data":[]})
        datatable_rows=request_credit_datatable(records_filtered,date_start,date_end).get("data",[])
        if not isinstance(datatable_rows,list):datatable_rows=[]
        credit_notes=[]
        used_credit_note_ids=set()
        category_counts=empty_counts.copy()
        for row in datatable_rows:
            if not isinstance(row,list) or len(row)<9:continue
            remark=str(row[5] or "").strip()
            normalized_remark=normalize_credit_remark(remark)
            category="no_problem_cn" if normalized_remark=="NOPROBLEMCN" else "problem_cn" if normalized_remark=="PROBLEMCN" else "others"
            credit_note_id=extract_credit_note_id(row[8])
            if not credit_note_id or credit_note_id in used_credit_note_ids:continue
            used_credit_note_ids.add(credit_note_id)
            dealer_name=str(row[3] or "-").strip() or "-"
            credit_notes.append({"credit_note_id":credit_note_id,"dealer_name":dealer_name,"credit_group":len(credit_notes),"credit_category":category,"credit_category_label":category_labels[category],"remark":remark or "-","credit_remark":remark or "-","credit_remark_normalized":normalized_remark})
            category_counts[category]+=1
        if not credit_notes:return jsonify({"status":True,"records_filtered":records_filtered,"matched_credit_notes":0,"report_rows":0,"category_counts":category_counts,"category_report_rows":empty_counts.copy(),"data":[]})
        credit_detail_results={}
        with ThreadPoolExecutor(max_workers=6) as executor:
            future_map={executor.submit(request_credit_detail,note["credit_note_id"],note["dealer_name"],note["credit_group"]):note for note in credit_notes}
            for future in as_completed(future_map):
                note=future_map[future]
                credit_note_id=note["credit_note_id"]
                try:
                    rows=future.result()
                    if not isinstance(rows,list):rows=[]
                    for detail in rows:
                        if isinstance(detail,dict):detail.update({"credit_note_id":credit_note_id,"credit_category":note["credit_category"],"credit_category_label":note["credit_category_label"],"remark":note["remark"],"credit_remark":note["credit_remark"],"credit_remark_normalized":note["credit_remark_normalized"]})
                    credit_detail_results[credit_note_id]=rows
                except PermissionError:raise
                except(requests.RequestException,TypeError,ValueError,RuntimeError) as error:
                    app.logger.error("Cannot retrieve credit note %s: %s",credit_note_id,error)
                    credit_detail_results[credit_note_id]=[]
        report_rows=[]
        category_report_rows=empty_counts.copy()
        for note in credit_notes:
            rows=credit_detail_results.get(note["credit_note_id"],[])
            report_rows.extend(rows)
            category_report_rows[note["credit_category"]]+=len(rows)
        return jsonify({"status":True,"records_filtered":records_filtered,"matched_credit_notes":len(credit_notes),"report_rows":len(report_rows),"category_counts":category_counts,"category_report_rows":category_report_rows,"data":report_rows})
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

@app.route("/open-invoices",methods=["POST"])
def open_invoices():
    from zoneinfo import ZoneInfo
    body=request.get_json(silent=True) or {}
    date_start=str(body.get("date_start","")).strip()
    date_end=str(body.get("date_end","")).strip() or datetime.now(ZoneInfo("Asia/Kuala_Lumpur")).strftime("%Y-%m-%d")
    try:
        datetime.strptime(date_end,"%Y-%m-%d")
        if date_start:
            datetime.strptime(date_start,"%Y-%m-%d")
            if date_start>date_end:return jsonify({"error":"date_start cannot be later than date_end."}),400
    except ValueError:return jsonify({"error":"Dates must use YYYY-MM-DD format."}),400
    session=build_sse_session()
    headers=build_sse_headers()
    try:
        response=session.post(SSE_APPROVALS_DATATABLE_URL,headers=headers,data=build_approved_payload(date_start,date_end),timeout=REQUEST_TIMEOUT_SECONDS)
        rows=parse_sse_json_response(response).get("data",[])
        result=[]
        with get_database_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            for row in rows:
                link=row[9].split('href="',1)[1].split('"',1)[0]
                sale_id=link.rstrip("/").split("/")[-1]
                sale_response=session.get(f"https://ssegroup.com.my/api/sales/{sale_id}",headers=headers,timeout=REQUEST_TIMEOUT_SECONDS)
                records=parse_sse_json_response(sale_response).get("data",{}).get("record",{}).get("records",[])
                result.append({"id":str(sale_id),"dealer":row[3],"remark":row[5],"date":row[8],"link":link,"items":build_order_items(connection,sale_id,records)})
        return jsonify(result)
    except requests.RequestException as error:
        app.logger.exception("SSE approved-order request failed")
        return jsonify({"error":"Unable to retrieve approved orders from SSE.","details":str(error)}),502
    except(KeyError,IndexError,TypeError,ValueError,RuntimeError,json.JSONDecodeError) as error:
        app.logger.exception("Unexpected approved-order response format")
        return jsonify({"error":"Unexpected approved-order data returned by SSE.","details":str(error)}),502
    except sqlite3.Error as error:
        app.logger.exception("Packaging database error")
        return jsonify({"error":"Packaging status database error.","details":str(error)}),500

initialize_database()

if __name__=="__main__":app.run(host="0.0.0.0",port=5000)
