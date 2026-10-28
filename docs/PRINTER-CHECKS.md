# Physical printer checks (cannot be done in the build sandbox)

Automated checks cover the receipt **text and layout**: fixed-width text never exceeds 32 columns (58 mm) or 48 columns
(80 mm), A4 renders as a table, the customer and "on account" amount appear, and in print media only the receipt is
visible. They do **not** prove what a physical printer does. Do these by hand once per printer model.

## Thermal printer (58 mm and 80 mm)

1. Install the printer's Windows driver (Settings > Printers & scanners) and print the driver's own test page first.
2. In the POS, complete a small sale and open the receipt. Choose **58 mm** or **80 mm** to match the paper roll.
3. Click **Print**. In the browser print dialog choose the thermal printer, **Margins: Default/None**, **Scale: 100%**,
   **turn off "Headers and footers"**.
4. Check: no line is cut off at the right edge; amounts line up in columns; nothing prints on a second blank page;
   the paper cuts/feeds after the footer; digits and the currency are readable.
5. Repeat with a long product name and a sale with a customer on account (the "On account" line must be visible).
6. If text is cut off, the printer's printable width is smaller than the roll: set the driver's paper size to the roll width
   and retry; report the printer model, paper width and a photo.

## A4 printer / PDF

1. Choose **A4**, click Print, destination **Save as PDF** first, then a real A4 printer.
2. Check the table is not split awkwardly, the totals are on the page, margins look right.

## Record the result

Printer model, roll width, driver, browser, OS, pass/fail per step, photo of a failing receipt.
