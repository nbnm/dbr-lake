"""Databricks Apps entry point; use its provided port without shell expansion."""
import os
import uvicorn

if __name__ == "__main__":
    uvicorn.run("backend.app:app", host="0.0.0.0", port=int(os.environ.get("DATABRICKS_APP_PORT", "8000")))
