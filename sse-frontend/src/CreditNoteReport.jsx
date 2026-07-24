import { useMemo, useState } from "react";
import axios from "axios";
import {
  utils,
  writeFileXLSX
} from "xlsx";
import "./CreditNoteReport.css";

const API_BASE_URL =
  "https://sse-sales-check.onrender.com";

const CREDIT_NOTE_REPORT_API_URL =
  `${API_BASE_URL}/credit-note-report`;
const getYesterdayDate = () => {
  const yesterday = new Date();

  yesterday.setDate(
    yesterday.getDate() - 1
  );

  const year = yesterday.getFullYear();

  const month = String(
    yesterday.getMonth() + 1
  ).padStart(2, "0");

  const day = String(
    yesterday.getDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

function CreditNoteReport({ onBack }) {
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState(
    getYesterdayDate
    );
  const [reportRows, setReportRows] = useState([]);
  const [recordsFiltered, setRecordsFiltered] =
    useState(0);
  const [
    matchedCreditNotes,
    setMatchedCreditNotes
  ] = useState(0);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  const totalRefundQty = useMemo(() => {
    return reportRows.reduce(
      (total, row) => {
        const quantity = Number(
          row.refund_qty
        );

        return total + (
          Number.isFinite(quantity)
            ? quantity
            : 0
        );
      },
      0
    );
  }, [reportRows]);

  const generateReport = async (event) => {
    event.preventDefault();

    if (!dateStart || !dateEnd) {
      setError(
        "Please select both start date and end date."
      );

      return;
    }

    if (dateStart > dateEnd) {
      setError(
        "Start date cannot be later than end date."
      );

      return;
    }

    setLoading(true);
    setError("");
    setReportRows([]);
    setRecordsFiltered(0);
    setMatchedCreditNotes(0);
    setProgress(
      "Retrieving Credits Note Report..."
    );

    try {
      const response = await axios.post(
        CREDIT_NOTE_REPORT_API_URL,
        {
          date_start: dateStart,
          date_end: dateEnd
        }
      );

      const rows = Array.isArray(
        response.data?.data
      )
        ? response.data.data
        : [];

      setReportRows(rows);

      setRecordsFiltered(
        Number(
          response.data?.records_filtered
        ) || 0
      );

      setMatchedCreditNotes(
        Number(
          response.data?.matched_credit_notes
        ) || 0
      );

      setProgress("");
    } catch (requestError) {
      console.error(
        "Cannot generate Credits Note Report",
        requestError
      );

      setError(
        requestError.response?.data?.error ||
        requestError.response?.data?.details ||
        requestError.message ||
        "Unable to generate the report."
      );

      setProgress("");
    } finally {
      setLoading(false);
    }
  };

  const exportToExcel = () => {
    if (reportRows.length === 0) {
        return;
    }

    const excelRows = [
        [
        "Dealer Name",
        "Date",
        "Code",
        "Name",
        "Description",
        "Refund Qty"
        ],
        ...reportRows.map((row) => [
        row.dealer_name,
        row.date,
        row.product_code,
        row.product_name,
        row.product_description,
        Number(row.refund_qty) || 0
        ])
    ];

    const worksheet = utils.aoa_to_sheet(
        excelRows
    );

    worksheet["!cols"] = [
        {
        wch: 25
        },
        {
        wch: 20
        },
        {
        wch: 18
        },
        {
        wch: 48
        },
        {
        wch: 48
        },
        {
        wch: 12
        }
    ];

    const workbook = utils.book_new();

    utils.book_append_sheet(
        workbook,
        worksheet,
        "Credit Note Report"
    );

    const filename =
        `Credit_Note_Report_` +
        `${dateStart}_to_${dateEnd}.xlsx`;

    writeFileXLSX(
        workbook,
        filename
    );
    };
    const formatShortDate = (dateValue) => {
    const datePart = String(dateValue || "")
        .split(" ")[0];

    const parts = datePart.split("-");

    if (parts.length !== 3) {
        return dateValue || "-";
    }

    const month = Number(parts[1]);
    const day = Number(parts[2]);

    return `${day}/${month}`;
    };

    const exportShortExcel = () => {
    if (reportRows.length === 0) {
        return;
    }

    const excelRows = [
        [
        "Date",
        "Code",
        "Description",
        "Qty"
        ],
        ...reportRows.map((row) => [
        formatShortDate(row.date),
        row.product_code,
        row.product_description,
        Number(row.refund_qty) || 0
        ])
    ];

    const worksheet = utils.aoa_to_sheet(
        excelRows
    );

    worksheet["!cols"] = [
        {
        wch: 12
        },
        {
        wch: 20
        },
        {
        wch: 50
        },
        {
        wch: 10
        }
    ];

    const workbook = utils.book_new();

    utils.book_append_sheet(
        workbook,
        worksheet,
        "Short Report"
    );

    const filename =
        `Credit_Note_Short_Report_` +
        `${dateStart}_to_${dateEnd}.xlsx`;

    writeFileXLSX(
        workbook,
        filename
    );
    };

  return (
    <div className="credit-report-page">
      <div className="credit-report-header">
        <div>
          <h2 className="credit-report-title">
            Credits Note Report
          </h2>

          <p className="credit-report-subtitle">
            Search by date and include only
            NO PROBLEM CN records.
          </p>
        </div>

        <button
          type="button"
          className="credit-report-back-button"
          onClick={onBack}
        >
          Back to Packaging Queue
        </button>
      </div>

      <form
        className="credit-report-filter-card"
        onSubmit={generateReport}
      >
        <label className="credit-report-field">
          <span className="credit-report-label">
            Start Date
          </span>

          <input
            type="date"
            value={dateStart}
            onChange={(event) =>
              setDateStart(
                event.target.value
              )
            }
            className="credit-report-input"
            disabled={loading}
          />
        </label>

        <label className="credit-report-field">
          <span className="credit-report-label">
            End Date
          </span>

          <input
            type="date"
            value={dateEnd}
            onChange={(event) =>
              setDateEnd(
                event.target.value
              )
            }
            className="credit-report-input"
            disabled={loading}
          />
        </label>

        <div className="credit-report-buttons">
        <button
            type="submit"
            className="credit-report-generate-button"
            disabled={loading}
        >
            {loading
            ? "Generating..."
            : "Generate Report"}
        </button>

        <button
            type="button"
            className="credit-report-export-button"
            onClick={exportToExcel}
            disabled={
            loading ||
            reportRows.length === 0
            }
        >
            Export Full Excel
        </button>

        <button
            type="button"
            className="credit-report-short-export-button"
            onClick={exportShortExcel}
            disabled={
            loading ||
            reportRows.length === 0
            }
        >
            Export Short Excel
        </button>
        </div>
      </form>

      {progress && (
        <div className="credit-report-info-message">
          {progress}
        </div>
      )}

      {error && (
        <div className="credit-report-error-message">
          {error}
        </div>
      )}

      <div className="credit-report-summary">
        <div className="credit-report-summary-item">
          <span>Filtered Records</span>
          <strong>{recordsFiltered}</strong>
        </div>

        <div className="credit-report-summary-item">
          <span>Matched Credit Notes</span>
          <strong>{matchedCreditNotes}</strong>
        </div>

        <div className="credit-report-summary-item">
          <span>Report Rows</span>
          <strong>{reportRows.length}</strong>
        </div>

        <div className="credit-report-summary-item">
          <span>Total Refund Qty</span>
          <strong>{totalRefundQty}</strong>
        </div>
      </div>

      <div className="credit-report-table-wrapper">
        <table className="credit-report-table">
          <thead>
            <tr>
              <th>Dealer Name</th>
              <th>Date</th>
              <th>Code</th>
              <th>Name</th>
              <th>Description</th>
              <th>Refund Qty</th>
            </tr>
          </thead>

          <tbody>
            {reportRows.length === 0 ? (
              <tr>
                <td
                  className="credit-report-empty-cell"
                  colSpan="6"
                >
                  {loading
                    ? "Loading report..."
                    : "No report data found."}
                </td>
              </tr>
            ) : (
              reportRows.map(
                (row, rowIndex) => {
                  const previousRow =
                    reportRows[
                      rowIndex - 1
                    ];

                  const isGroupStart =
                    rowIndex === 0 ||
                    previousRow
                      ?.credit_group !==
                      row.credit_group;

                  const groupColor =
                    Number(
                      row.credit_group
                    ) % 6;

                  return (
                    <tr
                      key={
                        `${row.credit_group}-` +
                        `${row.product_code}-` +
                        `${rowIndex}`
                      }
                      className={[
                        `credit-report-group-${groupColor}`,
                        isGroupStart
                          ? "credit-report-group-start"
                          : ""
                      ].join(" ")}
                    >
                      <td>
                        {row.dealer_name}
                      </td>

                      <td className="credit-report-date">
                        {row.date}
                      </td>

                      <td className="credit-report-product-code">
                        {row.product_code}
                      </td>

                      <td>
                        {row.product_name}
                      </td>

                      <td>
                        {
                          row.product_description
                        }
                      </td>

                      <td className="credit-report-quantity">
                        {row.refund_qty}
                      </td>
                    </tr>
                  );
                }
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default CreditNoteReport;