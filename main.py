import sys

from PySide6.QtWidgets import QApplication

from lococode.ui.mvp_window import LocoCodeMvpWindow


def main():
    app = QApplication(sys.argv)

    window = LocoCodeMvpWindow()
    window.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
