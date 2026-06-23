import time
import subprocess
import json
import urllib.request
import urllib.error

# ================= CONFIGURATION =================
# Set this to the local network IP and port of your portal server (e.g., http://192.168.1.15:3000)
# If testing locally on the same machine running the server, "http://localhost:3000" is fine.
PORTAL_URL = "http://localhost:3000" 
# Must match SMS_GATEWAY_API_KEY in your .env file
API_KEY = "gw_key_uasingishu_2026_x93f2k" 
# How often to check for new SMS (in seconds)
POLL_INTERVAL = 8 
# =================================================

def fetch_pending_sms():
    url = f"{PORTAL_URL}/api/v1/sms/pending"
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {API_KEY}")
    
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status == 200:
                return json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as e:
        print(f"[{time.strftime('%X')}] Network error connecting to portal: {e.reason}")
    except Exception as e:
        print(f"[{time.strftime('%X')}] Error fetching SMS: {e}")
    return []

def send_android_sms(phone_number, message):
    """
    Sends the SMS using the Termux API shell command.
    Requires Termux app and Termux:API app installed from F-Droid, 
    plus 'pkg install termux-api' run inside Termux.
    """
    print(f"Sending SMS to {phone_number}...")
    try:
        # Run termux-sms-send -n <phone> <message>
        result = subprocess.run(
            ["termux-sms-send", "-n", phone_number, message],
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode == 0:
            print(f"✅ Successfully sent message to {phone_number}")
            return True, ""
        else:
            error_msg = result.stderr.strip() if result.stderr else "Unknown termux-api error."
            print(f"❌ Failed to send to {phone_number}: {error_msg}")
            return False, error_msg
    except subprocess.TimeoutExpired:
        print(f"❌ Timeout sending SMS to {phone_number}")
        return False, "SMS transmission timed out."
    except FileNotFoundError:
        error_msg = "termux-sms-send command not found. Ensure Termux:API app is installed and 'pkg install termux-api' was executed."
        print(f"❌ {error_msg}")
        return False, error_msg
    except Exception as e:
        print(f"❌ Error dispatching SMS: {e}")
        return False, str(e)

def report_status(reports):
    url = f"{PORTAL_URL}/api/v1/sms/status"
    req = urllib.request.Request(url, method="POST")
    req.add_header("Authorization", f"Bearer {API_KEY}")
    req.add_header("Content-Type", "application/json")
    
    try:
        data = json.dumps(reports).encode("utf-8")
        with urllib.request.urlopen(req, data=data, timeout=5) as response:
            if response.status == 200:
                print(f"Reported status for {len(reports)} messages back to portal.")
                return True
    except Exception as e:
        print(f"Failed to report status back to portal: {e}")
    return False

def main():
    print("==================================================")
    print("      UG COUNTY LOCAL SMS GATEWAY SERVICE         ")
    print("==================================================")
    print(f"Target Portal: {PORTAL_URL}")
    print(f"Polling Interval: {POLL_INTERVAL} seconds")
    print("Starting loop... Press Ctrl+C to exit.\n")
    
    while True:
        pending = fetch_pending_sms()
        if pending:
            print(f"Received {len(pending)} pending SMS message(s) from portal.")
            reports = []
            
            for item in pending:
                sms_id = item.get("_id")
                to = item.get("to")
                msg = item.get("message")
                app_id = item.get("applicationId")
                
                if not to or not msg:
                    continue
                
                success, error_reason = send_android_sms(to, msg)
                
                reports.append({
                    "id": sms_id,
                    "status": "sent" if success else "failed",
                    "reason": error_reason,
                    "to": to,
                    "message": msg,
                    "applicationId": app_id
                })
            
            if reports:
                report_status(reports)
                
        time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nGateway service stopped.")
