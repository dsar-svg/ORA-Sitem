FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 ORA_DATA_DIR=/var/lib/ora
RUN useradd --system --user-group ora && install -d -o ora -g ora /var/lib/ora
COPY access.py app.py demo.py erp_auth.py model.py odoo_sales.py odoo_inventory.py stock_demo.py ./
COPY web/ web/
USER ora
EXPOSE 8765
CMD ["python", "app.py", "serve", "--erp-container"]
