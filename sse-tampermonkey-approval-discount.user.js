// ==UserScript==
// @name         Auto Calculate Discount and Amount
// @namespace    https://ssegroup.com.my/
// @version      2.0
// @description  Calculate 10% discount and amount
// @match        https://ssegroup.com.my/approvals/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/LiewCT/SSE_Sales_Check/main/sse-tampermonkey-approval-discount.user.js
// @downloadURL  https://raw.githubusercontent.com/LiewCT/SSE_Sales_Check/main/sse-tampermonkey-approval-discount.user.js
// ==/UserScript==

(() => {
    'use strict';

    function updateSaleTotals() {
        const footer = document.getElementById('tableFootSaleNote');
        if (!footer) return;

        const rows = footer.querySelectorAll('tr');

        let subtotal = 0;
        let discountCell = null;
        let amountCell = null;

        for (const row of rows) {
            const cells = [...row.querySelectorAll('td')];

            for (let i = 0; i < cells.length - 1; i++) {
                const label = cells[i].textContent.trim().toLowerCase();

                if (label === 'subtotal') {
                    subtotal = parseFloat(
                        cells[i + 1].textContent.replace(/[^0-9.-]/g, '')
                    ) || 0;
                }

                if (label === 'discount') {
                    discountCell = cells[i + 1];
                }

                if (label === 'amount') {
                    amountCell = cells[i + 1];
                }
            }
        }

        const discount = Math.round(subtotal * 10) / 100;
        const amount = Math.round((subtotal - discount) * 100) / 100;

        if (discountCell) {
            discountCell.textContent = 'MYR ' + discount.toFixed(2);
        }

        if (amountCell) {
            amountCell.textContent = 'MYR ' + amount.toFixed(2);
        }
    }

    let timer;

    function scheduleUpdate() {
        clearTimeout(timer);
        timer = setTimeout(updateSaleTotals, 200);
    }

    function init() {
        updateSaleTotals();

        const observer = new MutationObserver(scheduleUpdate);

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
