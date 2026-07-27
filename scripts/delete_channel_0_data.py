import psycopg2
import time
import sys

# Ensure UTF-8 output on Windows console
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

def delete_channel_0_data():
    db_params = {
        'host': '127.0.0.1',
        'port': 5432,
        'dbname': 'pmsystem2',
        'user': 'postgres',
        'password': 'Anduongb67'
    }

    print("=== ĐANG KẾT NỐI ĐẾN POSTGRESQL DATABASE ===")
    try:
        conn = psycopg2.connect(**db_params)
        cur = conn.cursor()
        
        # 1. Đếm số lượng bản ghi cần xóa
        cur.execute("SELECT COUNT(*) FROM pcb_results WHERE channel_id = 0;")
        pcb_count = cur.fetchone()[0]

        cur.execute("""
            SELECT COUNT(*) FROM test_steps 
            WHERE pcb_result_id IN (SELECT id FROM pcb_results WHERE channel_id = 0);
        """)
        step_count = cur.fetchone()[0]

        print(f"📊 Tìm thấy:")
        print(f"  - pcb_results (channel_id = 0): {pcb_count:,} bản ghi")
        print(f"  - test_steps tương ứng:         {step_count:,} bản ghi")

        if pcb_count == 0 and step_count == 0:
            print("✅ Không có dữ liệu rác channel_id = 0 nào cần xóa.")
            return

        print("\n⏳ Bắt đầu tiến trình xóa dữ liệu trong Transaction...")
        start_time = time.time()

        # 2. Xóa các dòng trong bảng test_steps trước (tránh lỗi khóa ngoại Foreign Key)
        print("  1/2: Đang xóa dữ liệu trong bảng test_steps...")
        cur.execute("""
            DELETE FROM test_steps 
            WHERE pcb_result_id IN (SELECT id FROM pcb_results WHERE channel_id = 0);
        """)
        deleted_steps = cur.rowcount

        # 3. Xóa các dòng trong bảng pcb_results
        print("  2/2: Đang xóa dữ liệu trong bảng pcb_results...")
        cur.execute("DELETE FROM pcb_results WHERE channel_id = 0;")
        deleted_pcb = cur.rowcount

        # Commit transaction
        conn.commit()
        elapsed = time.time() - start_time

        print(f"\n🎉 XÓA DỮ LIỆU THÀNH CÔNG (Thời gian: {elapsed:.2f}s)!")
        print(f"  - Đã xóa {deleted_steps:,} dòng trong bảng test_steps.")
        print(f"  - Đã xóa {deleted_pcb:,} dòng trong bảng pcb_results.")

    except Exception as e:
        if 'conn' in locals() and conn:
            conn.rollback()
        print(f"❌ Lỗi trong quá trình xóa dữ liệu: {e}")
    finally:
        if 'cur' in locals() and cur:
            cur.close()
        if 'conn' in locals() and conn:
            conn.close()

if __name__ == '__main__':
    delete_channel_0_data()
