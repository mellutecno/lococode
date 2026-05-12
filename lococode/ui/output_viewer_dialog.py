from PySide6.QtWidgets import (
    QDialog,
    QVBoxLayout,
    QHBoxLayout,
    QPushButton,
    QLabel,
    QTextEdit,
)
from PySide6.QtCore import Qt
from PySide6.QtGui import QGuiApplication


class OutputViewerDialog(QDialog):
    def __init__(self, parent=None, html_content="", plain_content=""):
        super().__init__(parent)

        self.setWindowTitle("Output LocoCode")
        self.setObjectName("outputViewerDialog")
        self.resize(1100, 680)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(18, 16, 18, 18)
        layout.setSpacing(12)

        header = QHBoxLayout()

        title = QLabel("Output completo")
        title.setObjectName("outputViewerTitle")

        self.copy_button = QPushButton("Copia")
        self.copy_button.clicked.connect(self.copy_text)

        close_button = QPushButton("Chiudi")
        close_button.clicked.connect(self.close)

        header.addWidget(title)
        header.addStretch()
        header.addWidget(self.copy_button)
        header.addWidget(close_button)

        self.text_area = QTextEdit()
        self.text_area.setReadOnly(True)
        self.text_area.setObjectName("outputViewerText")

        self.plain_content = plain_content or ""

        if html_content:
            self.text_area.setHtml(html_content)
        else:
            self.text_area.setPlainText(plain_content or "")

        layout.addLayout(header)
        layout.addWidget(self.text_area, stretch=1)

        self.apply_style()
        self.position_over_parent(parent)

    def position_over_parent(self, parent):
        if parent is not None:
            geo = parent.geometry()

            width = max(900, int(geo.width() * 0.88))
            height = max(560, int(geo.height() * 0.72))

            x = geo.x() + int((geo.width() - width) / 2)
            y = geo.y() + 64

            self.setGeometry(x, y, width, height)
            return

        screen = QGuiApplication.primaryScreen()

        if screen:
            geo = screen.availableGeometry()
            width = int(geo.width() * 0.82)
            height = int(geo.height() * 0.72)
            x = geo.x() + int((geo.width() - width) / 2)
            y = geo.y() + 80
            self.setGeometry(x, y, width, height)

    def copy_text(self):
        text = self.plain_content or self.text_area.toPlainText()
        QGuiApplication.clipboard().setText(text)

    def apply_style(self):
        self.setStyleSheet("""
            #outputViewerDialog {
                background-color: #090b18;
            }

            #outputViewerTitle {
                color: #ffffff;
                font-size: 22px;
                font-weight: 900;
            }

            QPushButton {
                background-color: rgba(255,255,255,0.12);
                color: white;
                border: 1px solid rgba(255,255,255,0.14);
                border-radius: 14px;
                padding: 10px 15px;
                font-weight: 800;
            }

            QPushButton:hover {
                background-color: rgba(255,255,255,0.22);
            }

            #outputViewerText {
                background-color: rgba(8, 13, 31, 0.92);
                color: #f8fafc;
                border: 1px solid rgba(255,255,255,0.12);
                border-radius: 20px;
                padding: 18px;
                font-size: 15px;
                line-height: 1.5;
            }
        """)
