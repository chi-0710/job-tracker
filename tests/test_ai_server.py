import base64
from http import HTTPStatus
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.error import URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import ai_server


def image_data_url() -> str:
    return "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\nmock").decode("ascii")


class AiServerUnitTest(unittest.TestCase):
    def test_load_dotenv_keeps_existing_environment_values(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text("EXISTING=from-file\nNEW_VALUE='loaded'\n", encoding="utf-8")
            with patch.dict(ai_server.os.environ, {"EXISTING": "from-system"}, clear=True):
                ai_server.load_dotenv(path)
                self.assertEqual(ai_server.os.environ["EXISTING"], "from-system")
                self.assertEqual(ai_server.os.environ["NEW_VALUE"], "loaded")

    def test_validate_image_data_url(self):
        self.assertEqual(ai_server.validate_image_data_url(image_data_url()), image_data_url())
        with self.assertRaisesRegex(ai_server.ServiceError, "仅支持"):
            ai_server.validate_image_data_url("data:image/gif;base64,R0lGODlh")
        forged = "data:image/png;base64," + base64.b64encode(b"not-png").decode("ascii")
        with self.assertRaisesRegex(ai_server.ServiceError, "文件格式不一致"):
            ai_server.validate_image_data_url(forged)

    def test_normalize_model_data_forces_safe_defaults(self):
        normalized = ai_server.normalize_model_data({
            "isJobPosting": True,
            "company": {
                "name": " 测试公司 ",
                "location": "北京",
                "companyType": "unknown",
                "note": "备注",
                "ignored": "不能保留",
            },
            "position": {
                "name": "研发工程师",
                "salary": "20-30K",
                "channel": "官网",
                "applicationDate": "2026-09-13",
                "status": "applied",
                "note": "职责",
            },
            "warnings": [" 请确认 ", 123],
            "ignored": "不能保留",
        })
        self.assertEqual(normalized["company"]["name"], "测试公司")
        self.assertEqual(normalized["company"]["companyType"], "")
        self.assertNotIn("ignored", normalized)
        self.assertNotIn("ignored", normalized["company"])
        self.assertEqual(normalized["position"]["applicationDate"], "")
        self.assertEqual(normalized["position"]["status"], "pending")
        self.assertEqual(normalized["warnings"], ["请确认"])

    def test_non_job_image_is_rejected(self):
        with self.assertRaises(ai_server.ServiceError) as context:
            ai_server.normalize_model_data({"isJobPosting": False})
        self.assertEqual(context.exception.code, "NOT_JOB_POSTING")

    def test_dashscope_network_failure_is_retried_once(self):
        model_data = {
            "isJobPosting": True,
            "company": {"name": "重试公司", "location": "", "companyType": "", "note": ""},
            "position": {
                "name": "测试岗位", "salary": "", "channel": "", "applicationDate": "",
                "status": "pending", "note": "",
            },
            "warnings": [],
        }
        upstream = json.dumps({
            "choices": [{"message": {"content": json.dumps(model_data, ensure_ascii=False)}}],
        }, ensure_ascii=False).encode("utf-8")

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self, _limit):
                return upstream

        config = {
            "api_key": "test-key",
            "api_base": "https://example.invalid/v1",
            "model": "qwen3.8-flash",
        }
        with patch.object(ai_server, "urlopen", side_effect=[URLError("temporary"), FakeResponse()]) as mocked:
            result = ai_server.call_dashscope(image_data_url(), config)
        self.assertEqual(mocked.call_count, 2)
        self.assertEqual(result["company"]["name"], "重试公司")


class AiServerHttpTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ai_server.JobTrackerHandler.config = {
            "api_key": "test-secret-key",
            "api_base": "https://example.invalid/v1",
            "model": "qwen3.8-flash",
            "port": 0,
        }
        ai_server.JobTrackerHandler.recent_requests.clear()
        cls.server = ai_server.ThreadingHTTPServer(("127.0.0.1", 0), ai_server.JobTrackerHandler)
        port = cls.server.server_address[1]
        ai_server.JobTrackerHandler.config["port"] = port
        cls.base_url = f"http://127.0.0.1:{port}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def test_health_and_secret_files(self):
        with urlopen(f"{self.base_url}/api/health", timeout=2) as response:
            payload = json.load(response)
        self.assertTrue(payload["available"])
        self.assertEqual(payload["model"], "qwen3.8-flash")

        for path in ("/.env", "/.gitignore", "/../.env"):
            with self.assertRaises(HTTPError) as context:
                urlopen(f"{self.base_url}{path}", timeout=2)
            self.assertEqual(context.exception.code, HTTPStatus.NOT_FOUND)

    def test_extract_endpoint_returns_normalized_data(self):
        model_result = {
            "isJobPosting": True,
            "company": {"name": "接口公司", "location": "上海", "companyType": "", "note": ""},
            "position": {
                "name": "测试岗位", "salary": "", "channel": "", "applicationDate": "",
                "status": "pending", "note": "岗位详情",
            },
            "warnings": [],
        }
        body = json.dumps({"image": image_data_url()}).encode("utf-8")
        request = Request(
            f"{self.base_url}/api/job-extract",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with patch.object(ai_server, "call_dashscope", return_value=model_result):
            with urlopen(request, timeout=2) as response:
                payload = json.load(response)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["data"]["company"]["name"], "接口公司")

    def test_service_error_does_not_leak_secret(self):
        body = json.dumps({"image": image_data_url()}).encode("utf-8")
        request = Request(
            f"{self.base_url}/api/job-extract",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        error = ai_server.ServiceError("AUTH_FAILED", "API Key 无效", HTTPStatus.BAD_GATEWAY)
        with patch.object(ai_server, "call_dashscope", side_effect=error):
            with self.assertRaises(HTTPError) as context:
                urlopen(request, timeout=2)
        response_body = context.exception.read().decode("utf-8")
        self.assertNotIn("test-secret-key", response_body)
        self.assertIn("AUTH_FAILED", response_body)


if __name__ == "__main__":
    unittest.main()
