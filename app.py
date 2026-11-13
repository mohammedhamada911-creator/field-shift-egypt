"""Field Shift Egypt — Flask entry point."""
from __future__ import annotations

import logging
import os

from flask import Flask, jsonify, render_template

from fieldshift.api import api
from fieldshift.config import APP_NAME, APP_VERSION, DB_PATH
from fieldshift.errors import FieldShiftError
from fieldshift.storage import configure_storage


def create_app(test_config: dict | None = None) -> Flask:
    app = Flask(__name__, static_folder="static", template_folder="templates")
    app.config.update(
        JSON_SORT_KEYS=False,
        MAX_CONTENT_LENGTH=1_000_000,
        APP_NAME=APP_NAME,
        APP_VERSION=APP_VERSION,
    )
    if test_config:
        app.config.update(test_config)
    app.json.sort_keys = False
    configure_storage(app.config.get("DATABASE_PATH", str(DB_PATH)))

    logging.basicConfig(
        level=os.environ.get("FIELDSHIFT_LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    app.register_blueprint(api)

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.errorhandler(FieldShiftError)
    def handle_fieldshift_error(exc: FieldShiftError):
        return jsonify(exc.to_dict()), exc.status_code

    @app.errorhandler(404)
    def not_found(_exc):
        return jsonify({"error": {"code": "not_found", "message": "Route not found."}}), 404

    @app.errorhandler(500)
    def server_error(exc):
        app.logger.exception("Unhandled error: %s", exc)
        return (
            jsonify(
                {
                    "error": {
                        "code": "internal_error",
                        "message": "An unexpected server error occurred.",
                        "detail": None,
                    }
                }
            ),
            500,
        )

    @app.after_request
    def security_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        return response

    return app


app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    app.run(host="127.0.0.1", port=port, debug=os.environ.get("FIELDSHIFT_DEBUG") == "1")
