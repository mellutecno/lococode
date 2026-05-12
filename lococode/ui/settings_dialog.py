import json
import os

from PySide6.QtWidgets import (
    QDialog,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QMessageBox,
)


CONFIG_PATH = os.path.join("user_data", "config.json")


class SettingsDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)

        self.setWindowTitle("Impostazioni LocoCode")
        self.resize(700, 260)

        self.config = self.load_config()

        layout = QVBoxLayout(self)

        title = QLabel("Impostazioni API")
        title.setStyleSheet("font-size: 20px; font-weight: bold;")

        subtitle = QLabel("Provider principale: OpenRouter")
        subtitle.setStyleSheet("color: #b8c1d1;")

        api_label = QLabel("OpenRouter API Key:")

        self.openrouter_key_input = QLineEdit()
        self.openrouter_key_input.setEchoMode(QLineEdit.Password)
        self.openrouter_key_input.setPlaceholderText("Incolla qui la tua API key OpenRouter")
        self.openrouter_key_input.setText(self.config.get("openrouter_api_key", ""))

        button_layout = QHBoxLayout()

        save_button = QPushButton("Salva")
        save_button.clicked.connect(self.save_settings)

        button_layout.addStretch()
        button_layout.addWidget(save_button)

        layout.addWidget(title)
        layout.addWidget(subtitle)
        layout.addWidget(api_label)
        layout.addWidget(self.openrouter_key_input)
        layout.addStretch()
        layout.addLayout(button_layout)

        self.setStyleSheet("""
            QDialog {
                background-color: #0f1117;
                color: #e6e6e6;
            }

            QLabel {
                color: #e6e6e6;
                font-size: 14px;
            }

            QLineEdit {
                background-color: #151925;
                color: white;
                border: 1px solid #2c3344;
                border-radius: 8px;
                padding: 10px;
            }

            QPushButton {
                background-color: #2563eb;
                color: white;
                border: none;
                border-radius: 8px;
                padding: 9px 14px;
            }

            QPushButton:hover {
                background-color: #1d4ed8;
            }
        """)

    def load_config(self):
        default_config = {
            "openrouter_api_key": "",
            "default_provider": "OpenRouter",
            "default_model": "moonshotai/kimi-k2.6"
        }

        if not os.path.exists(CONFIG_PATH):
            return default_config

        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                config = json.load(f)

            for key, value in default_config.items():
                if key not in config:
                    config[key] = value

            return config
        except Exception:
            return default_config

    def save_settings(self):
        self.config["openrouter_api_key"] = self.openrouter_key_input.text().strip()
        self.config["default_provider"] = "OpenRouter"

        if not self.config.get("default_model"):
            self.config["default_model"] = "moonshotai/kimi-k2.6"

        os.makedirs("user_data", exist_ok=True)

        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(self.config, f, indent=2)

        QMessageBox.information(
            self,
            "Salvato",
            "API key OpenRouter salvata correttamente."
        )
        self.accept()
