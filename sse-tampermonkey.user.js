// ==UserScript==
// @name         SSE Discount, Stock, Code & Smart Search Highlight
// @namespace    sse-discount
// @version      3.4
// @description  Discount, stock warning, South City highlight, code difference, smart search highlighting, auto CASH dealer selection and 10% review cart price
// @match        https://ssegroup.com.my/dealers/orders/new*
// @match        https://www.ssegroup.com.my/dealers/orders/new*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/LiewCT/SSE_Sales_Check/main/sse-tampermonkey.user.js
// @downloadURL  https://raw.githubusercontent.com/LiewCT/SSE_Sales_Check/main/sse-tampermonkey.user.js
// ==/UserScript==

(() => {
'use strict';

const UPDATE_INTERVAL = 500;

function addStyles(){
  if(document.getElementById('tm-sse-style')) return;

  const style = document.createElement('style');
  style.id = 'tm-sse-style';

  style.textContent = `
    @keyframes tmStockWarning{
      0%,100%{
        opacity:1;
        transform:scale(1)
      }
      50%{
        opacity:.3;
        transform:scale(1.1)
      }
    }

    .tm-no-stock{
      color:#dc3545!important;
      font-size:16px!important;
      font-weight:bold!important;
      white-space:nowrap;
      animation:tmStockWarning .8s infinite
    }

    .tm-discount-price{
      width:105px;
      min-width:105px;
      padding:4px!important;
      text-align:center;
      white-space:nowrap
    }

    .tm-discount-value{
      color:#198754;
      font-size:18px;
      font-weight:bold
    }

    .tm-copy-btn{
      margin-left:7px;
      padding:2px 5px;
      border:0;
      background:transparent;
      color:#007bff;
      font-size:15px;
      cursor:pointer
    }

    .tm-copy-btn:hover{
      transform:scale(1.2)
    }

    .tm-copy-success{
      color:#198754!important
    }

    .tm-code-difference{
      color:#dc3545!important;
      font-weight:bold
    }

    .tm-search-match{
      color:#dc3545!important;
      font-weight:bold
    }

    /*
     * Review Cart 10% Off column
     */
    .tm-review-discount-price{
      width:105px;
      min-width:105px;
      padding:4px!important;
      text-align:center;
      white-space:nowrap
    }

    .tm-review-discount-value{
      color:#198754;
      font-size:16px;
      font-weight:bold
    }
  `;

  document.head.appendChild(style);
}

async function copyPureText(value,button){
  const text = String(value).trim();

  try{
    await navigator.clipboard.writeText(text);
  }catch(error){
    const textarea = document.createElement('textarea');

    textarea.value = text;
    textarea.setAttribute('readonly','');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';

    document.body.appendChild(textarea);

    textarea.select();
    textarea.setSelectionRange(
      0,
      textarea.value.length
    );

    try{
      document.execCommand('copy');
    }catch(e){
      console.error('Copy failed:',e);
    }

    textarea.remove();
  }

  const originalHTML = button.innerHTML;

  button.innerHTML = '✓';
  button.classList.add('tm-copy-success');

  setTimeout(()=>{
    button.innerHTML = originalHTML;
    button.classList.remove('tm-copy-success');
  },1000);
}

function commonPrefix(values){
  if(!values.length) return '';

  let prefix = values[0];

  for(const value of values.slice(1)){
    while(
      prefix &&
      !value.startsWith(prefix)
    ){
      prefix = prefix.slice(0,-1);
    }
  }

  return prefix;
}

function commonSuffix(values,prefixLength){
  if(!values.length) return '';

  let suffix =
    values[0].slice(prefixLength);

  for(const value of values.slice(1)){
    const remaining =
      value.slice(prefixLength);

    while(
      suffix &&
      !remaining.endsWith(suffix)
    ){
      suffix = suffix.slice(1);
    }
  }

  return suffix;
}

function highlightCodeDifferences(rows){
  const codes = [];

  rows.forEach(row=>{
    const cell = row.children[2];

    if(!cell) return;

    if(
      cell.dataset.originalCode === undefined
    ){
      cell.dataset.originalCode =
        cell.textContent.trim();
    }

    const code =
      cell.dataset.originalCode;

    if(code){
      codes.push(code);
    }
  });

  const uniqueCodes =
    [...new Set(codes)];

  if(uniqueCodes.length < 2){
    rows.forEach(row=>{
      const cell = row.children[2];

      if(!cell) return;

      const original =
        cell.dataset.originalCode;

      if(
        original &&
        cell.dataset.highlighted === 'true'
      ){
        cell.textContent = original;
        cell.dataset.highlighted = 'false';
        cell.dataset.highlightSignature = '';
      }
    });

    return;
  }

  const prefix =
    commonPrefix(uniqueCodes);

  const suffix =
    commonSuffix(
      uniqueCodes,
      prefix.length
    );

  const signature =
    JSON.stringify([
      uniqueCodes,
      prefix,
      suffix
    ]);

  rows.forEach(row=>{
    const cell = row.children[2];

    if(!cell) return;

    const code =
      cell.dataset.originalCode ||
      cell.textContent.trim();

    if(
      cell.dataset.highlightSignature ===
      signature
    ){
      return;
    }

    const differentEnd =
      suffix
        ? code.length - suffix.length
        : code.length;

    const different =
      code.slice(
        prefix.length,
        differentEnd
      );

    cell.innerHTML = '';

    if(prefix){
      const span =
        document.createElement('span');

      span.textContent = prefix;

      cell.appendChild(span);
    }

    if(different){
      const span =
        document.createElement('span');

      span.className =
        'tm-code-difference';

      span.textContent = different;

      cell.appendChild(span);
    }

    if(suffix){
      const span =
        document.createElement('span');

      span.textContent = suffix;

      cell.appendChild(span);
    }

    cell.dataset.highlightSignature =
      signature;

    cell.dataset.highlighted =
      'true';
  });
}

function getSearchTokens(searchValue){
  return searchValue
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function highlightSearchResults(){
  const searchInput =
    document.querySelector(
      '#searchProducts'
    );

  const dropdown =
    document.querySelector(
      '#searchProductsDropdown'
    );

  if(!searchInput || !dropdown) return;

  const searchValue =
    searchInput.value.trim();

  if(!searchValue){
    dropdown
      .querySelectorAll(
        '.create-order-v2-dropdown-item'
      )
      .forEach(item=>{
        if(
          item.dataset.originalName !==
          undefined
        ){
          const original =
            item.dataset.originalName;

          if(
            item.textContent !== original
          ){
            item.textContent = original;
          }

          item.dataset.searchHighlight = '';
        }
      });

    return;
  }

  const tokens =
    getSearchTokens(searchValue);

  if(!tokens.length) return;

  const escapedTokens =
    tokens.map(token=>
      token.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
      )
    );

  const regex =
    new RegExp(
      `(${escapedTokens.join('|')})`,
      'gi'
    );

  dropdown
    .querySelectorAll(
      '.create-order-v2-dropdown-item'
    )
    .forEach(item=>{

      if(
        item.dataset.originalName ===
        undefined
      ){
        item.dataset.originalName =
          item.dataset.productName ||
          item.textContent.trim();
      }

      const originalName =
        item.dataset.originalName;

      const signature =
        `${originalName}|||${searchValue}`;

      if(
        item.dataset.searchHighlight ===
        signature
      ){
        return;
      }

      regex.lastIndex = 0;

      const matches = [];
      let match;

      while(
        (match = regex.exec(originalName)) !==
        null
      ){
        matches.push({
          start: match.index,
          end:
            match.index +
            match[0].length
        });

        if(
          regex.lastIndex ===
          match.index
        ){
          regex.lastIndex++;
        }
      }

      if(!matches.length){
        if(
          item.textContent !== originalName
        ){
          item.textContent =
            originalName;
        }

        item.dataset.searchHighlight =
          signature;

        return;
      }

      matches.sort(
        (a,b)=>
          a.start-b.start ||
          a.end-b.end
      );

      const merged = [];

      matches.forEach(match=>{
        const last =
          merged[merged.length-1];

        if(
          !last ||
          match.start > last.end
        ){
          merged.push({
            start:match.start,
            end:match.end
          });
        }else{
          last.end =
            Math.max(
              last.end,
              match.end
            );
        }
      });

      const fragment =
        document.createDocumentFragment();

      let lastIndex = 0;

      merged.forEach(match=>{
        if(match.start > lastIndex){
          fragment.appendChild(
            document.createTextNode(
              originalName.slice(
                lastIndex,
                match.start
              )
            )
          );
        }

        const highlight =
          document.createElement('span');

        highlight.className =
          'tm-search-match';

        highlight.textContent =
          originalName.slice(
            match.start,
            match.end
          );

        fragment.appendChild(
          highlight
        );

        lastIndex = match.end;
      });

      if(
        lastIndex <
        originalName.length
      ){
        fragment.appendChild(
          document.createTextNode(
            originalName.slice(lastIndex)
          )
        );
      }

      item.replaceChildren(fragment);

      item.dataset.searchHighlight =
        signature;
    });
}

/*
 * ==========================================
 * AUTO SELECT CASH DEALER
 * ==========================================
 *
 * Types CASH into #searchDealer, waits for
 * the real SSE dropdown and clicks the FIRST
 * .create-order-v2-dropdown-item.
 */
function selectCashDealer(){
  const input =
    document.querySelector(
      '#searchDealer'
    );

  if(!input) return;

  if(
    input.dataset.cashSelected === 'true' ||
    input.dataset.cashSelecting === 'true'
  ){
    return;
  }

  input.dataset.cashSelecting = 'true';

  const setter =
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set;

  if(setter){
    setter.call(input,'CASH');
  }else{
    input.value = 'CASH';
  }

  input.focus();

  input.dispatchEvent(
    new Event('input',{
      bubbles:true
    })
  );

  input.dispatchEvent(
    new Event('change',{
      bubbles:true
    })
  );

  let attempts = 0;

  const timer =
    setInterval(()=>{
      attempts++;

      const dropdown =
        document.querySelector(
          '#searchDealerDropdown'
        );

      const firstResult =
        dropdown?.querySelector(
          '.create-order-v2-dropdown-item'
        );

      if(firstResult){
        clearInterval(timer);

        firstResult.dispatchEvent(
          new MouseEvent('mousedown',{
            bubbles:true,
            cancelable:true,
            view:window
          })
        );

        firstResult.dispatchEvent(
          new MouseEvent('mouseup',{
            bubbles:true,
            cancelable:true,
            view:window
          })
        );

        firstResult.click();

        setTimeout(()=>{
          input.dataset.cashSelected =
            'true';

          input.dataset.cashSelecting =
            '';

          const productSearch =
            document.querySelector(
              '#searchProducts'
            );

          if(productSearch){
            productSearch.focus();
            productSearch.select();
          }
        },300);

        return;
      }

      if(attempts >= 50){
        clearInterval(timer);
        input.dataset.cashSelecting = '';
      }

    },100);
}

function isNoDiscountProduct(row){
  const text =
    row.textContent
      .replace(/\s+/g,' ')
      .trim();

  return /9\s*tech/i.test(text);
}

function updateStock(currentQtyCell){
  if(!currentQtyCell) return;

  let currentQty;

  if(
    currentQtyCell.dataset.originalQty !==
    undefined
  ){
    currentQty =
      Number(
        currentQtyCell.dataset.originalQty
      );
  }else{
    currentQty =
      Number(
        currentQtyCell.textContent
          .replace(/[^0-9.-]/g,'')
      );

    currentQtyCell.dataset.originalQty =
      currentQty;
  }

  if(currentQty === 0){
    if(
      !currentQtyCell.querySelector(
        '.tm-no-stock'
      )
    ){
      currentQtyCell.innerHTML =
        '<span class="tm-no-stock">⚠ NO STOCK</span>';
    }

    return;
  }

  const noStockElement =
    currentQtyCell.querySelector(
      '.tm-no-stock'
    );

  if(noStockElement){
    currentQtyCell.textContent =
      String(currentQty);
  }
}

function updateBranchHighlight(row,branch){
  const isSouthCity =
    branch === 'South City';

  [...row.children].forEach(cell=>{
    const expected =
      isSouthCity
        ? 'rgb(255, 243, 205)'
        : '';

    if(
      cell.style.backgroundColor !==
      expected
    ){
      cell.style.backgroundColor =
        isSouthCity
          ? '#fff3cd'
          : '';
    }
  });
}

function updateDiscount(
  row,
  priceCell,
  qtyInput,
  noDiscount
){
  let discountCell =
    row.querySelector(
      '.tm-discount-price'
    );

  if(noDiscount){
    if(discountCell){
      discountCell.remove();
    }

    return;
  }

  if(!discountCell){
    discountCell =
      document.createElement('td');

    discountCell.className =
      'tm-discount-price';

    priceCell.insertAdjacentElement(
      'afterend',
      discountCell
    );
  }

  const price =
    Number(
      qtyInput?.dataset.price ||
      priceCell.textContent
        .replace(/[^0-9.-]/g,'')
    );

  const discount =
    Number.isFinite(price)
      ? (price * 0.9).toFixed(2)
      : '-';

  if(
    discountCell.dataset.value ===
    discount
  ){
    return;
  }

  discountCell.dataset.value =
    discount;

  discountCell.innerHTML = '';

  const priceSpan =
    document.createElement('span');

  priceSpan.className =
    'tm-discount-value';

  priceSpan.textContent =
    discount;

  discountCell.appendChild(
    priceSpan
  );

  const button =
    document.createElement('button');

  button.className =
    'tm-copy-btn';

  button.type = 'button';

  button.title =
    `Copy ${discount}`;

  button.innerHTML =
    '<i class="fas fa-copy"></i>';

  button.addEventListener(
    'click',
    event=>{
      event.preventDefault();
      event.stopPropagation();

      copyPureText(
        discount,
        button
      );
    }
  );

  discountCell.appendChild(
    button
  );
}

function addDiscountHeader(table){
  const headerRow =
    table.querySelector(
      'thead tr'
    );

  if(!headerRow) return;

  if(
    headerRow.querySelector(
      '.tm-discount-header'
    )
  ){
    return;
  }

  const priceHeader =
    [...headerRow.children].find(
      th =>
        th.textContent.trim() ===
        'Price'
    );

  if(!priceHeader) return;

  const header =
    document.createElement('th');

  header.className =
    'tm-discount-header';

  header.textContent =
    '10% Off';

  header.style.cssText =
    'width:105px;min-width:105px;padding:6px 4px;font-size:15px;text-align:center;white-space:nowrap';

  priceHeader.insertAdjacentElement(
    'afterend',
    header
  );
}

/*
 * ==========================================
 * REVIEW CART 10% OFF COLUMN
 * ==========================================
 *
 * Existing table:
 *
 * No. | Type | Branch | Code | Description |
 * Qty | Price | Subtotal | Action
 *
 * Becomes:
 *
 * No. | Type | Branch | Code | Description |
 * Qty | 10% Off | Price | Subtotal | Action
 *
 * 10% Off = Price × 0.9
 */
function addReviewCartDiscountHeader(){
  const tableBody =
    document.querySelector(
      '#reviewCartTableBody'
    );

  if(!tableBody) return;

  const table =
    tableBody.closest('table');

  if(!table) return;

  const headerRow =
    table.querySelector(
      'thead tr'
    );

  if(!headerRow) return;

  if(
    headerRow.querySelector(
      '.tm-review-discount-header'
    )
  ){
    return;
  }

  /*
   * Find the Price header and insert
   * the new 10% Off header before it.
   */
  const headers =
    [...headerRow.children];

  const priceHeader =
    headers.find(
      th =>
        th.textContent.trim()
          .toLowerCase() === 'price'
    );

  if(!priceHeader) return;

  const header =
    document.createElement('th');

  header.className =
    'tm-review-discount-header';

  header.textContent =
    '10% Off';

  header.style.cssText =
    'width:105px;min-width:105px;padding:6px 4px;font-size:15px;text-align:center;white-space:nowrap';

  /*
   * Insert BEFORE Price.
   */
  priceHeader.insertAdjacentElement(
    'beforebegin',
    header
  );
}

function updateReviewCartDiscounts(){
  const tableBody =
    document.querySelector(
      '#reviewCartTableBody'
    );

  if(!tableBody) return;

  const table =
    tableBody.closest('table');

  if(!table) return;

  addReviewCartDiscountHeader();

  /*
   * Make sure every row has exactly
   * one 10% Off cell before Price.
   */
  const rows =
    tableBody.querySelectorAll('tr');

  rows.forEach(row=>{
    const cells =
      [...row.children];

    /*
     * Locate the actual Price cell using
     * its existing class.
     */
    const priceCell =
      row.querySelector(
        '.review-cart-price'
      );

    if(!priceCell) return;

    /*
     * Qty input is the existing quantity
     * input in the row.
     */
    const qtyInput =
      row.querySelector(
        '.review-cart-qty'
      );

    /*
     * Read original Price.
     *
     * Example:
     * 221.00 -> 198.90
     */
    const price =
      Number(
        priceCell.textContent
          .replace(/[^0-9.-]/g,'')
      );

    if(!Number.isFinite(price)) return;

    const discountedPrice =
      (price * 0.9).toFixed(2);

    /*
     * Check whether the discount cell
     * already exists.
     */
    let discountCell =
      row.querySelector(
        '.tm-review-discount-price'
      );

    /*
     * If it doesn't exist, create it and
     * insert it immediately BEFORE Price.
     */
    if(!discountCell){
      discountCell =
        document.createElement('td');

      discountCell.className =
        'tm-review-discount-price';

      priceCell.insertAdjacentElement(
        'beforebegin',
        discountCell
      );
    }

    /*
     * Avoid unnecessary DOM updates.
     */
    if(
      discountCell.dataset.value ===
      discountedPrice
    ){
      return;
    }

    discountCell.dataset.value =
      discountedPrice;

    discountCell.innerHTML = '';

    const span =
      document.createElement('span');

    span.className =
      'tm-review-discount-value';

    span.textContent =
      discountedPrice;

    discountCell.appendChild(
      span
    );

    /*
     * Copy button for convenience.
     */
    const button =
      document.createElement('button');

    button.type = 'button';

    button.className =
      'tm-copy-btn';

    button.title =
      `Copy ${discountedPrice}`;

    button.innerHTML =
      '<i class="fas fa-copy"></i>';

    button.addEventListener(
      'click',
      event=>{
        event.preventDefault();
        event.stopPropagation();

        copyPureText(
          discountedPrice,
          button
        );
      }
    );

    discountCell.appendChild(
      button
    );
  });
}

function updateTable(){
  /*
   * Automatically select CASH dealer.
   */
  selectCashDealer();

  /*
   * Update the Review Cart table.
   */
  updateReviewCartDiscounts();

  const table =
    document.querySelector(
      '.create-order-v2-variants-table'
    );

  if(!table) return;

  addDiscountHeader(table);

  const rows = [
    ...document.querySelectorAll(
      '#variantsTableBody tr'
    )
  ];

  highlightCodeDifferences(rows);

  rows.forEach(row=>{
    const cells =
      row.children;

    const branch =
      cells[0]?.textContent.trim();

    const currentQtyCell =
      cells[5];

    const priceCell =
      row.querySelector(
        '.variant-price'
      );

    const qtyInput =
      row.querySelector(
        '.variant-qty'
      );

    if(
      !priceCell ||
      !currentQtyCell
    ){
      return;
    }

    updateBranchHighlight(
      row,
      branch
    );

    updateStock(
      currentQtyCell
    );

    const noDiscount =
      isNoDiscountProduct(row);

    updateDiscount(
      row,
      priceCell,
      qtyInput,
      noDiscount
    );
  });
}

addStyles();

updateTable();

setInterval(
  updateTable,
  UPDATE_INTERVAL
);

document.addEventListener(
  'input',
  event=>{
    if(
      event.target &&
      event.target.id ===
      'searchProducts'
    ){
      highlightSearchResults();
    }

    /*
     * Recalculate review cart discount
     * when quantity is changed.
     */
    if(
      event.target &&
      event.target.classList.contains(
        'review-cart-qty'
      )
    ){
      updateReviewCartDiscounts();
    }
  }
);

document.addEventListener(
  'change',
  event=>{
    if(
      event.target &&
      event.target.classList.contains(
        'review-cart-qty'
      )
    ){
      updateReviewCartDiscounts();
    }
  }
);

/*
 * Observe Product Search dropdown.
 */
const searchDropdown =
  document.querySelector(
    '#searchProductsDropdown'
  );

if(searchDropdown){
  const observer =
    new MutationObserver(
      mutations=>{
        let changed = false;

        for(
          const mutation of mutations
        ){
          if(
            mutation.type === 'childList' &&
            (
              mutation.addedNodes.length ||
              mutation.removedNodes.length
            )
          ){
            changed = true;
            break;
          }
        }

        if(changed){
          highlightSearchResults();
        }
      }
    );

  observer.observe(
    searchDropdown,
    {
      childList:true,
      subtree:true
    }
  );
}

/*
 * Observe Review Cart table.
 *
 * This is important because SSE may rebuild
 * the cart rows dynamically after adding,
 * removing, or changing products.
 */
const reviewCartBody =
  document.querySelector(
    '#reviewCartTableBody'
  );

if(reviewCartBody){
  const reviewCartObserver =
    new MutationObserver(()=>{
      updateReviewCartDiscounts();
    });

  reviewCartObserver.observe(
    reviewCartBody,
    {
      childList:true,
      subtree:true,
      characterData:true
    }
  );
}

highlightSearchResults();

updateReviewCartDiscounts();

})();
