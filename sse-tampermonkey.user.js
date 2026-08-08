// ==UserScript==
// @name         SSE Discount, Stock, Code & Smart Search Highlight
// @namespace    sse-discount
// @version      3.1
// @description  Discount, stock warning, South City highlight, code difference and smart search highlighting
// @match        https://ssegroup.com.my/dealers/orders/new*
// @match        https://www.ssegroup.com.my/dealers/orders/new*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/LiewCT/SSE_Sales_Check/main/sse-tampermonkey.user.js
// @downloadURL  https://raw.githubusercontent.com/LiewCT/SSE_Sales_Check/main/sse-tampermonkey.user.js
// ==/UserScript==
 (() => {
  'use strict';
   /*
   * ==========================================
   * SETTINGS
   * ==========================================
   */
   const UPDATE_INTERVAL = 500;
   /*
   * ==========================================
   * STYLES
   * ==========================================
   */
   function addStyles() {
     if (
      document.getElementById('tm-sse-style')
    ) {
      return;
    }
     const style =
      document.createElement('style');
     style.id =
      'tm-sse-style';
     style.textContent = `
       /*
       * ==============================
       * NO STOCK
       * ==============================
       */
       @keyframes tmStockWarning {
         0%, 100% {
          opacity: 1;
          transform: scale(1);
        }
         50% {
          opacity: .3;
          transform: scale(1.1);
        }
       }
       .tm-no-stock {
         color: #dc3545 !important;
         font-size: 16px !important;
         font-weight: bold !important;
         white-space: nowrap;
         animation:
          tmStockWarning .8s infinite;
       }
       /*
       * ==============================
       * DISCOUNT
       * ==============================
       */
       .tm-discount-price {
         width: 105px;
         min-width: 105px;
         padding: 4px !important;
         text-align: center;
         white-space: nowrap;
       }
       .tm-discount-value {
         color: #198754;
         font-size: 18px;
         font-weight: bold;
       }
       /*
       * ==============================
       * COPY BUTTON
       * ==============================
       */
       .tm-copy-btn {
         margin-left: 7px;
         padding: 2px 5px;
         border: 0;
         background: transparent;
         color: #007bff;
         font-size: 15px;
         cursor: pointer;
       }
       .tm-copy-btn:hover {
         transform: scale(1.2);
       }
       .tm-copy-success {
         color: #198754 !important;
       }
       /*
       * ==============================
       * CODE DIFFERENCE
       * ==============================
       *
       * Red font only.
       * No background.
       */
       .tm-code-difference {
         color: #dc3545 !important;
         font-weight: bold;
       }
       /*
       * ==============================
       * SEARCH MATCH
       * ==============================
       *
       * Red font only.
       */
       .tm-search-match {
         color: #dc3545 !important;
         font-weight: bold;
       }
     `;
     document.head.appendChild(
      style
    );
  }
   /*
   * ==========================================
   * COPY PURE TEXT
   * ==========================================
   */
   async function copyPureText(
    value,
    button
  ) {
     const text =
      String(value).trim();
     try {
       /*
       * Copy ONLY plain text.
       */
       await navigator.clipboard.writeText(
        text
      );
     } catch (error) {
       /*
       * Fallback.
       */
       const textarea =
        document.createElement(
          'textarea'
        );
       textarea.value =
        text;
       textarea.setAttribute(
        'readonly',
        ''
      );
       textarea.style.position =
        'fixed';
       textarea.style.left =
        '-9999px';
       textarea.style.top =
        '0';
       document.body.appendChild(
        textarea
      );
       textarea.select();
       textarea.setSelectionRange(
        0,
        textarea.value.length
      );
       try {
         document.execCommand(
          'copy'
        );
       } catch (e) {
         console.error(
          'Copy failed:',
          e
        );
       }
       textarea.remove();
    }
     /*
     * Show copied status.
     */
     const originalHTML =
      button.innerHTML;
     button.innerHTML =
      '✓';
     button.classList.add(
      'tm-copy-success'
    );
     setTimeout(() => {
       button.innerHTML =
        originalHTML;
       button.classList.remove(
        'tm-copy-success'
      );
     }, 1000);
   }
   /*
   * ==========================================
   * COMMON PREFIX
   * ==========================================
   */
   function commonPrefix(
    values
  ) {
     if (
      !values.length
    ) {
       return '';
     }
     let prefix =
      values[0];
     for (
      const value of values.slice(1)
    ) {
       while (
        prefix &&
        !value.startsWith(prefix)
      ) {
         prefix =
          prefix.slice(0, -1);
       }
     }
     return prefix;
  }
   /*
   * ==========================================
   * COMMON SUFFIX
   * ==========================================
   */
   function commonSuffix(
    values,
    prefixLength
  ) {
     if (
      !values.length
    ) {
       return '';
     }
     let suffix =
      values[0].slice(
        prefixLength
      );
     for (
      const value of values.slice(1)
    ) {
       const remaining =
        value.slice(
          prefixLength
        );
       while (
        suffix &&
        !remaining.endsWith(
          suffix
        )
      ) {
         suffix =
          suffix.slice(1);
       }
     }
     return suffix;
  }
   /*
   * ==========================================
   * CODE DIFFERENCE HIGHLIGHT
   * ==========================================
   */
   function highlightCodeDifferences(
    rows
  ) {
     const codes = [];
     /*
     * Get original codes.
     *
     * Code column = children[2]
     */
     rows.forEach(row => {
       const cell =
        row.children[2];
       if (!cell) {
        return;
      }
       /*
       * Save original code ONLY ONCE.
       */
       if (
        cell.dataset.originalCode ===
        undefined
      ) {
         cell.dataset.originalCode =
          cell.textContent.trim();
       }
       const code =
        cell.dataset.originalCode;
       if (code) {
         codes.push(
          code
        );
       }
     });
     /*
     * Unique codes.
     */
     const uniqueCodes =
      [
        ...new Set(codes)
      ];
     /*
     * Less than 2 different codes.
     */
     if (
      uniqueCodes.length < 2
    ) {
       rows.forEach(row => {
         const cell =
          row.children[2];
         if (!cell) {
          return;
        }
         const original =
          cell.dataset.originalCode;
         if (
          original &&
          cell.dataset.highlighted ===
          'true'
        ) {
           cell.textContent =
            original;
           cell.dataset.highlighted =
            'false';
           cell.dataset.highlightSignature =
            '';
         }
       });
       return;
    }
     /*
     * Find common beginning.
     */
     const prefix =
      commonPrefix(
        uniqueCodes
      );
     /*
     * Find common ending.
     */
     const suffix =
      commonSuffix(
        uniqueCodes,
        prefix.length
      );
     /*
     * Signature.
     *
     * If unchanged, DOM is untouched.
     */
     const signature =
      JSON.stringify([
        uniqueCodes,
        prefix,
        suffix
      ]);
     rows.forEach(row => {
       const cell =
        row.children[2];
       if (!cell) {
        return;
      }
       const code =
        cell.dataset.originalCode ||
        cell.textContent.trim();
       /*
       * Already highlighted correctly.
       */
       if (
        cell.dataset.highlightSignature ===
        signature
      ) {
         return;
       }
       /*
       * Find different section.
       */
       const differentEnd =
        suffix
          ? code.length -
            suffix.length
          : code.length;
       const different =
        code.slice(
          prefix.length,
          differentEnd
        );
       /*
       * Rebuild only when changed.
       */
       cell.innerHTML =
        '';
       /*
       * Prefix.
       */
       if (prefix) {
         const span =
          document.createElement(
            'span'
          );
         span.textContent =
          prefix;
         cell.appendChild(
          span
        );
       }
       /*
       * Different section.
       */
       if (different) {
         const span =
          document.createElement(
            'span'
          );
         span.className =
          'tm-code-difference';
         span.textContent =
          different;
         cell.appendChild(
          span
        );
       }
       /*
       * Suffix.
       */
       if (suffix) {
         const span =
          document.createElement(
            'span'
          );
         span.textContent =
          suffix;
         cell.appendChild(
          span
        );
       }
       cell.dataset.highlightSignature =
        signature;
       cell.dataset.highlighted =
        'true';
     });
   }
   /*
   * ==========================================
   * SMART SEARCH TOKENIZER
   * ==========================================
   *
   * Example:
   *
   * Search:
   * ss a36
   *
   * Tokens:
   * ss
   * a36
   *
   * Product:
   * SAMSUNG A36
   *
   * "ss"   -> not found
   * "a36"  -> found
   *
   * Result:
   * SAMSUNG A36
   *         ^^^
   */
   function getSearchTokens(
    searchValue
  ) {
     return searchValue
      .trim()
      .split(/\s+/)
      .filter(Boolean);
   }
   /*
   * ==========================================
   * SMART SEARCH MATCH HIGHLIGHT
   * ==========================================
   */
   function highlightSearchResults() {
     const searchInput =
      document.querySelector(
        '#searchProducts'
      );
     const dropdown =
      document.querySelector(
        '#searchProductsDropdown'
      );
     if (
      !searchInput ||
      !dropdown
    ) {
       return;
     }
     /*
     * Current search.
     */
     const searchValue =
      searchInput.value.trim();
     /*
     * No search.
     *
     * Restore original names.
     */
     if (!searchValue) {
       dropdown
        .querySelectorAll(
          '.create-order-v2-dropdown-item'
        )
        .forEach(item => {
           if (
            item.dataset.originalName !==
            undefined
          ) {
             const original =
              item.dataset.originalName;
             if (
              item.textContent !==
              original
            ) {
               item.textContent =
                original;
             }
             item.dataset.searchHighlight =
              '';
           }
         });
       return;
    }
     /*
     * Split search into words.
     *
     * Example:
     *
     * "ss a36"
     *
     * becomes:
     *
     * ["ss", "a36"]
     */
     const tokens =
      getSearchTokens(
        searchValue
      );
     /*
     * Nothing to search.
     */
     if (
      !tokens.length
    ) {
       return;
     }
     /*
     * Escape regex special chars.
     */
     const escapedTokens =
      tokens.map(token =>
        token.replace(
          /[.*+?^${}()|[\]\\]/g,
          '\\$&'
        )
      );
     /*
     * Create one regex for ALL
     * search tokens.
     *
     * Example:
     *
     * ss a36
     *
     * becomes:
     *
     * /(ss|a36)/gi
     */
     const regex =
      new RegExp(
        `(${escapedTokens.join('|')})`,
        'gi'
      );
     /*
     * Process every search result.
     */
     dropdown
      .querySelectorAll(
        '.create-order-v2-dropdown-item'
      )
      .forEach(item => {
         /*
         * Save original product name.
         */
         if (
          item.dataset.originalName ===
          undefined
        ) {
           item.dataset.originalName =
            item.dataset.productName ||
            item.textContent.trim();
         }
         const originalName =
          item.dataset.originalName;
         /*
         * Signature.
         *
         * Prevents unnecessary DOM rebuilding.
         */
         const signature =
          `${originalName}|||${searchValue}`;
         if (
          item.dataset.searchHighlight ===
          signature
        ) {
           return;
         }
         /*
         * Find actual matches first.
         */
         regex.lastIndex =
          0;
         const matches = [];
         let match;
         while (
          (
            match =
              regex.exec(
                originalName
              )
          ) !== null
        ) {
           matches.push({
            start: match.index,
            end:
              match.index +
              match[0].length
          });
           /*
           * Safety.
           */
           if (
            regex.lastIndex ===
            match.index
          ) {
             regex.lastIndex++;
          }
         }
         /*
         * No token matched this product.
         *
         * Keep original text.
         */
         if (
          !matches.length
        ) {
           if (
            item.textContent !==
            originalName
          ) {
             item.textContent =
              originalName;
           }
           item.dataset.searchHighlight =
            signature;
           return;
         }
         /*
         * Merge overlapping matches.
         */
         matches.sort(
          (a, b) =>
            a.start - b.start ||
            a.end - b.end
        );
         const merged = [];
         matches.forEach(match => {
           const last =
            merged[
              merged.length - 1
            ];
           if (
            !last ||
            match.start > last.end
          ) {
             merged.push({
              start: match.start,
              end: match.end
            });
           } else {
             last.end =
              Math.max(
                last.end,
                match.end
              );
           }
         });
         /*
         * Build highlighted result.
         */
         const fragment =
          document.createDocumentFragment();
         let lastIndex =
          0;
         merged.forEach(match => {
           /*
           * Text before match.
           */
           if (
            match.start >
            lastIndex
          ) {
             fragment.appendChild(
              document.createTextNode(
                originalName.slice(
                  lastIndex,
                  match.start
                )
              )
            );
           }
           /*
           * Highlight match.
           */
           const highlight =
            document.createElement(
              'span'
            );
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
           lastIndex =
            match.end;
         });
         /*
         * Text after final match.
         */
         if (
          lastIndex <
          originalName.length
        ) {
           fragment.appendChild(
            document.createTextNode(
              originalName.slice(
                lastIndex
              )
            )
          );
         }
         /*
         * Replace only once.
         */
         item.replaceChildren(
          fragment
        );
         item.dataset.searchHighlight =
          signature;
       });
   }
   /*
   * ==========================================
   * PRODUCT NAME CHECK
   * ==========================================
   */
   function isNoDiscountProduct(
    row
  ) {
     const text =
      row.textContent
        .replace(
          /\s+/g,
          ' '
        )
        .trim();
     /*
     * Matches:
     *
     * 9tech
     * 9 tech
     * 9 TECH
     * 9Tech
     * NEX9TECH
     * NEX 9 TECH
     */
     return /9\s*tech/i.test(
      text
    );
   }
   /*
   * ==========================================
   * STOCK UPDATE
   * ==========================================
   */
   function updateStock(
    currentQtyCell
  ) {
     if (
      !currentQtyCell
    ) {
       return;
     }
     let currentQty;
     /*
     * Save original quantity ONCE.
     */
     if (
      currentQtyCell.dataset.originalQty
      !== undefined
    ) {
       currentQty =
        Number(
          currentQtyCell.dataset.originalQty
        );
     } else {
       currentQty =
        Number(
          currentQtyCell.textContent
            .replace(
              /[^0-9.-]/g,
              ''
            )
        );
       currentQtyCell.dataset.originalQty =
        currentQty;
     }
     /*
     * NO STOCK.
     */
     if (
      currentQty === 0
    ) {
       if (
        !currentQtyCell.querySelector(
          '.tm-no-stock'
        )
      ) {
         currentQtyCell.innerHTML =
          '<span class="tm-no-stock">⚠ NO STOCK</span>';
       }
       return;
    }
     /*
     * Normal stock.
     */
     const noStockElement =
      currentQtyCell.querySelector(
        '.tm-no-stock'
      );
     /*
     * Only change if currently
     * showing NO STOCK.
     */
     if (
      noStockElement
    ) {
       currentQtyCell.textContent =
        String(currentQty);
     }
   }
   /*
   * ==========================================
   * SOUTH CITY HIGHLIGHT
   * ==========================================
   */
   function updateBranchHighlight(
    row,
    branch
  ) {
     const isSouthCity =
      branch ===
      'South City';
     [...row.children].forEach(
      cell => {
         const expected =
          isSouthCity
            ? 'rgb(255, 243, 205)'
            : '';
         /*
         * Don't repeatedly write
         * the same style.
         */
         if (
          cell.style.backgroundColor !==
          expected
        ) {
           cell.style.backgroundColor =
            isSouthCity
              ? '#fff3cd'
              : '';
         }
       }
    );
   }
   /*
   * ==========================================
   * DISCOUNT UPDATE
   * ==========================================
   */
   function updateDiscount(
    row,
    priceCell,
    qtyInput,
    noDiscount
  ) {
     let discountCell =
      row.querySelector(
        '.tm-discount-price'
      );
     /*
     * 9 TECH
     *
     * NO DISCOUNT.
     */
     if (
      noDiscount
    ) {
       if (
        discountCell
      ) {
         discountCell.remove();
       }
       return;
     }
     /*
     * Normal product.
     */
     if (
      !discountCell
    ) {
       discountCell =
        document.createElement(
          'td'
        );
       discountCell.className =
        'tm-discount-price';
       priceCell.insertAdjacentElement(
        'afterend',
        discountCell
      );
     }
     /*
     * Get price.
     */
     const price =
      Number(
        qtyInput?.dataset.price ||
        priceCell.textContent
          .replace(
            /[^0-9.-]/g,
            ''
          )
      );
     /*
     * Calculate 10% off.
     */
     const discount =
      Number.isFinite(
        price
      )
        ? (
            price * 0.9
          ).toFixed(2)
        : '-';
     /*
     * No change.
     *
     * Do not rebuild DOM.
     */
     if (
      discountCell.dataset.value ===
      discount
    ) {
       return;
     }
     discountCell.dataset.value =
      discount;
     /*
     * Build discount cell.
     */
     discountCell.innerHTML =
      '';
     /*
     * Price text.
     */
     const priceSpan =
      document.createElement(
        'span'
      );
     priceSpan.className =
      'tm-discount-value';
     priceSpan.textContent =
      discount;
     discountCell.appendChild(
      priceSpan
    );
     /*
     * Copy button.
     */
     const button =
      document.createElement(
        'button'
      );
     button.className =
      'tm-copy-btn';
     button.type =
      'button';
     button.title =
      `Copy ${discount}`;
     button.innerHTML =
      '<i class="fas fa-copy"></i>';
     /*
     * Copy PURE TEXT only.
     */
     button.addEventListener(
      'click',
      event => {
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
   /*
   * ==========================================
   * DISCOUNT HEADER
   * ==========================================
   */
   function addDiscountHeader(
    table
  ) {
     const headerRow =
      table.querySelector(
        'thead tr'
      );
     if (
      !headerRow
    ) {
       return;
     }
     /*
     * Already exists.
     */
     if (
      headerRow.querySelector(
        '.tm-discount-header'
      )
    ) {
       return;
     }
     const priceHeader =
      [
        ...headerRow.children
      ].find(
        th =>
          th.textContent.trim() ===
          'Price'
      );
     if (
      !priceHeader
    ) {
       return;
     }
     const header =
      document.createElement(
        'th'
      );
     header.className =
      'tm-discount-header';
     header.textContent =
      '10% Off';
     header.style.cssText =
      'width:105px;' +
      'min-width:105px;' +
      'padding:6px 4px;' +
      'font-size:15px;' +
      'text-align:center;' +
      'white-space:nowrap';
     priceHeader.insertAdjacentElement(
      'afterend',
      header
    );
   }
   /*
   * ==========================================
   * MAIN TABLE UPDATE
   * ==========================================
   */
   function updateTable() {
     const table =
      document.querySelector(
        '.create-order-v2-variants-table'
      );
     if (
      !table
    ) {
       return;
     }
     /*
     * Header.
     */
     addDiscountHeader(
      table
    );
     /*
     * Rows.
     */
     const rows =
      [
        ...document.querySelectorAll(
          '#variantsTableBody tr'
        )
      ];
     /*
     * Code highlight.
     */
     highlightCodeDifferences(
      rows
    );
     /*
     * Process rows.
     */
     rows.forEach(row => {
       const cells =
        row.children;
       /*
       * Branch.
       */
       const branch =
        cells[0]?.textContent.trim();
       /*
       * Stock.
       */
       const currentQtyCell =
        cells[5];
       /*
       * Price.
       */
       const priceCell =
        row.querySelector(
          '.variant-price'
        );
       /*
       * Quantity input.
       */
       const qtyInput =
        row.querySelector(
          '.variant-qty'
        );
       if (
        !priceCell ||
        !currentQtyCell
      ) {
         return;
       }
       /*
       * South City.
       *
       * Works even for 9 Tech.
       */
       updateBranchHighlight(
        row,
        branch
      );
       /*
       * Stock.
       */
       updateStock(
        currentQtyCell
      );
       /*
       * 9 Tech.
       */
       const noDiscount =
        isNoDiscountProduct(
          row
        );
       /*
       * Discount.
       */
       updateDiscount(
        row,
        priceCell,
        qtyInput,
        noDiscount
      );
     });
   }
   /*
   * ==========================================
   * START
   * ==========================================
   */
   addStyles();
   updateTable();
   /*
   * ==========================================
   * CONTINUOUS TABLE CHECK
   * ==========================================
   *
   * Checks every 500ms.
   *
   * DOM is only changed when something
   * actually changed.
   */
   setInterval(
    updateTable,
    UPDATE_INTERVAL
  );
   /*
   * ==========================================
   * SEARCH INPUT EVENT
   * ==========================================
   *
   * Highlight immediately while typing.
   */
   document.addEventListener(
    'input',
    event => {
       if (
        event.target &&
        event.target.id ===
        'searchProducts'
      ) {
         highlightSearchResults();
       }
     }
  );
   /*
   * ==========================================
   * SEARCH DROPDOWN OBSERVER
   * ==========================================
   *
   * Website dynamically creates search
   * results.
   */
   const searchDropdown =
    document.querySelector(
      '#searchProductsDropdown'
    );
   if (
    searchDropdown
  ) {
     const observer =
      new MutationObserver(
        mutations => {
           let changed =
            false;
           for (
            const mutation of mutations
          ) {
             if (
              mutation.type ===
              'childList' &&
              (
                mutation.addedNodes.length ||
                mutation.removedNodes.length
              )
            ) {
               changed =
                true;
               break;
             }
           }
           if (
            changed
          ) {
             highlightSearchResults();
           }
         }
      );
     observer.observe(
      searchDropdown,
      {
        childList: true,
        subtree: true
      }
    );
   }
   /*
   * ==========================================
   * INITIAL SEARCH HIGHLIGHT
   * ==========================================
   */
   highlightSearchResults();
 })();
 