import html as html_tools
import os
from pathlib import Path

from PySide6.QtCore import QObject, QThread, Qt, QUrl, Signal, Slot
from PySide6.QtGui import QDesktopServices, QPixmap, QTextCursor
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import (
    QApplication,
    QComboBox,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSizePolicy,
    QSplitter,
    QStackedWidget,
    QTextBrowser,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from lococode.core.mvp_builder import COMMON_MODELS, ROOT_DIR, MvpBuilder


LOGO_PATH = ROOT_DIR / "assets" / "lococode_logo_crop.png"


class BuildWorker(QObject):
    finished = Signal(object)
    failed = Signal(str)

    def __init__(self, builder: MvpBuilder, mode: str, payload: dict):
        super().__init__()
        self.builder = builder
        self.mode = mode
        self.payload = payload

    @Slot()
    def run(self):
        try:
            if self.mode == "create":
                result = self.builder.create_app_from_prompt(**self.payload)
            else:
                result = self.builder.rebuild_app(**self.payload)
            self.finished.emit(result)
        except Exception as exc:
            self.failed.emit(str(exc))


class LocoCodeMvpWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.builder = MvpBuilder()
        self.apps: list[dict] = []
        self.selected_app_id: str | None = None
        self.active_threads: list[QThread] = []
        self.is_busy = False

        self.setWindowTitle("LocoCode")
        self.resize(1360, 820)
        self.setMinimumSize(1120, 700)

        self._build_ui()
        self._apply_style()
        self.reload_apps(select_first=True)

    def _build_ui(self):
        root = QWidget()
        self.setCentralWidget(root)
        root_layout = QHBoxLayout(root)
        root_layout.setContentsMargins(0, 0, 0, 0)
        root_layout.setSpacing(0)

        self.nav = self._build_nav()
        self.apps_panel = self._build_apps_panel()
        self.stack = QStackedWidget()

        self.home_page = self._build_home_page()
        self.chat_page = self._build_chat_page()
        self.settings_page = self._build_settings_page()

        self.stack.addWidget(self.home_page)
        self.stack.addWidget(self.chat_page)
        self.stack.addWidget(self.settings_page)

        root_layout.addWidget(self.nav)
        root_layout.addWidget(self.apps_panel)
        root_layout.addWidget(self.stack, stretch=1)

    def _build_nav(self) -> QFrame:
        nav = QFrame()
        nav.setObjectName("navRail")
        nav.setFixedWidth(82)
        layout = QVBoxLayout(nav)
        layout.setContentsMargins(12, 16, 12, 16)
        layout.setSpacing(12)

        logo = QLabel()
        logo.setObjectName("railLogo")
        logo.setAlignment(Qt.AlignCenter)
        logo.setFixedSize(58, 58)
        self._set_logo(logo, 54, 54)
        layout.addWidget(logo, alignment=Qt.AlignCenter)
        layout.addSpacing(10)

        self.nav_apps = self._nav_button("Apps")
        self.nav_chat = self._nav_button("Chat")
        self.nav_settings = self._nav_button("Set")

        self.nav_apps.clicked.connect(lambda: self.show_page(0))
        self.nav_chat.clicked.connect(lambda: self.show_page(1))
        self.nav_settings.clicked.connect(lambda: self.show_page(2))

        layout.addWidget(self.nav_apps)
        layout.addWidget(self.nav_chat)
        layout.addWidget(self.nav_settings)
        layout.addStretch()
        return nav

    def _build_apps_panel(self) -> QFrame:
        panel = QFrame()
        panel.setObjectName("appsPanel")
        panel.setFixedWidth(278)
        layout = QVBoxLayout(panel)
        layout.setContentsMargins(18, 18, 16, 18)
        layout.setSpacing(12)

        title = QLabel("Your Apps")
        title.setObjectName("sectionTitle")
        layout.addWidget(title)

        self.new_app_button = QPushButton("New App")
        self.new_app_button.setObjectName("newAppButton")
        self.new_app_button.clicked.connect(self.focus_new_app)
        layout.addWidget(self.new_app_button)

        self.app_list = QListWidget()
        self.app_list.setObjectName("appList")
        self.app_list.currentItemChanged.connect(self.on_app_selected)
        layout.addWidget(self.app_list, stretch=1)

        self.sidebar_hint = QLabel("Local apps live in user_data/apps")
        self.sidebar_hint.setObjectName("mutedSmall")
        self.sidebar_hint.setWordWrap(True)
        layout.addWidget(self.sidebar_hint)
        return panel

    def _build_home_page(self) -> QWidget:
        page = QWidget()
        page.setObjectName("page")
        layout = QVBoxLayout(page)
        layout.setContentsMargins(42, 34, 42, 34)
        layout.setSpacing(22)

        header = self._top_header("LocoCode", "Full Access mode")
        layout.addWidget(header)
        layout.addStretch(1)

        logo = QLabel()
        logo.setObjectName("heroLogo")
        logo.setAlignment(Qt.AlignCenter)
        logo.setFixedHeight(116)
        self._set_logo(logo, 420, 112)
        layout.addWidget(logo)

        title = QLabel("Build your dream app")
        title.setObjectName("heroTitle")
        title.setAlignment(Qt.AlignCenter)
        title.setWordWrap(True)
        layout.addWidget(title)

        prompt_card = QFrame()
        prompt_card.setObjectName("promptCard")
        prompt_card.setMinimumWidth(620)
        prompt_card.setMaximumWidth(760)
        prompt_layout = QVBoxLayout(prompt_card)
        prompt_layout.setContentsMargins(18, 14, 18, 14)
        prompt_layout.setSpacing(10)

        self.home_prompt = QTextEdit()
        self.home_prompt.setObjectName("promptInput")
        self.home_prompt.setPlaceholderText("Ask LocoCode to build...")
        self.home_prompt.setMinimumHeight(74)
        self.home_prompt.setMaximumHeight(92)
        prompt_layout.addWidget(self.home_prompt)

        controls = QHBoxLayout()
        controls.setSpacing(10)
        self.model_combo = self._model_combo()
        self.build_button = QPushButton("Generate")
        self.build_button.setObjectName("primaryButton")
        self.build_button.clicked.connect(self.create_from_home_prompt)
        controls.addWidget(self.model_combo)
        controls.addStretch()
        controls.addWidget(self.build_button)
        prompt_layout.addLayout(controls)

        layout.addWidget(prompt_card, alignment=Qt.AlignHCenter)

        quick_row = QHBoxLayout()
        quick_row.setSpacing(12)
        for label, prompt in [
            ("TODO list app", "Create a polished TODO list app with local storage and filters."),
            ("Landing Page", "Create a landing page for a premium AI productivity product."),
            ("Sign Up Form", "Create a sign up form with validation and success state."),
        ]:
            button = QPushButton(label)
            button.setObjectName("quickButton")
            button.clicked.connect(lambda _checked=False, text=prompt: self.quick_create(text))
            quick_row.addWidget(button)
        layout.addLayout(quick_row)

        layout.addStretch(2)
        return page

    def _build_chat_page(self) -> QWidget:
        page = QWidget()
        page.setObjectName("page")
        layout = QVBoxLayout(page)
        layout.setContentsMargins(28, 24, 28, 24)
        layout.setSpacing(14)

        top = self._top_header("Chat", "Edit and preview")
        layout.addWidget(top)

        splitter = QSplitter(Qt.Horizontal)
        splitter.setObjectName("mainSplitter")

        chat_panel = QFrame()
        chat_panel.setObjectName("contentPanel")
        chat_layout = QVBoxLayout(chat_panel)
        chat_layout.setContentsMargins(18, 18, 18, 18)
        chat_layout.setSpacing(12)

        row = QHBoxLayout()
        self.chat_title = QLabel("No app selected")
        self.chat_title.setObjectName("panelTitle")
        self.open_folder_button = QPushButton("Open Folder")
        self.open_folder_button.setObjectName("secondaryButton")
        self.open_folder_button.clicked.connect(self.open_selected_folder)
        row.addWidget(self.chat_title)
        row.addStretch()
        row.addWidget(self.open_folder_button)
        chat_layout.addLayout(row)

        self.chat_history = QTextBrowser()
        self.chat_history.setObjectName("chatHistory")
        chat_layout.addWidget(self.chat_history, stretch=1)

        self.chat_prompt = QTextEdit()
        self.chat_prompt.setObjectName("chatPrompt")
        self.chat_prompt.setPlaceholderText("Ask for a change to the selected app...")
        self.chat_prompt.setMinimumHeight(82)
        self.chat_prompt.setMaximumHeight(110)
        chat_layout.addWidget(self.chat_prompt)

        send_row = QHBoxLayout()
        self.file_count_label = QLabel("0 files")
        self.file_count_label.setObjectName("mutedSmall")
        self.chat_send_button = QPushButton("Apply Change")
        self.chat_send_button.setObjectName("primaryButton")
        self.chat_send_button.clicked.connect(self.send_chat_prompt)
        send_row.addWidget(self.file_count_label)
        send_row.addStretch()
        send_row.addWidget(self.chat_send_button)
        chat_layout.addLayout(send_row)

        preview_panel = QFrame()
        preview_panel.setObjectName("contentPanel")
        preview_layout = QVBoxLayout(preview_panel)
        preview_layout.setContentsMargins(14, 14, 14, 14)
        preview_layout.setSpacing(10)

        preview_top = QHBoxLayout()
        preview_label = QLabel("Preview")
        preview_label.setObjectName("panelTitle")
        self.preview_status = QLabel("No preview loaded")
        self.preview_status.setObjectName("mutedSmall")
        refresh_button = QPushButton("Reload")
        refresh_button.setObjectName("secondaryButton")
        refresh_button.clicked.connect(self.load_selected_preview)
        preview_top.addWidget(preview_label)
        preview_top.addStretch()
        preview_top.addWidget(self.preview_status)
        preview_top.addWidget(refresh_button)
        preview_layout.addLayout(preview_top)

        self.preview = QWebEngineView()
        self.preview.setObjectName("preview")
        preview_layout.addWidget(self.preview, stretch=1)

        self.files_list = QListWidget()
        self.files_list.setObjectName("filesList")
        self.files_list.setMaximumHeight(138)
        preview_layout.addWidget(self.files_list)

        splitter.addWidget(chat_panel)
        splitter.addWidget(preview_panel)
        splitter.setSizes([430, 760])
        layout.addWidget(splitter, stretch=1)
        return page

    def _build_settings_page(self) -> QWidget:
        page = QWidget()
        page.setObjectName("page")
        layout = QVBoxLayout(page)
        layout.setContentsMargins(42, 34, 42, 34)
        layout.setSpacing(18)

        layout.addWidget(self._top_header("Settings", "Provider setup"))

        card = QFrame()
        card.setObjectName("settingsCard")
        card.setMaximumWidth(760)
        form = QVBoxLayout(card)
        form.setContentsMargins(24, 24, 24, 24)
        form.setSpacing(14)

        title = QLabel("OpenRouter")
        title.setObjectName("panelTitle")
        note = QLabel("L'MVP funziona anche offline con il generatore locale. Con una API key usa il modello scelto per generare file piu specifici.")
        note.setObjectName("mutedText")
        note.setWordWrap(True)

        key_label = QLabel("API key")
        key_label.setObjectName("fieldLabel")
        self.api_key_input = QLineEdit()
        self.api_key_input.setObjectName("lineInput")
        self.api_key_input.setEchoMode(QLineEdit.Password)
        self.api_key_input.setPlaceholderText("sk-or-v1-...")

        model_label = QLabel("Default model")
        model_label.setObjectName("fieldLabel")
        self.settings_model_combo = self._model_combo()

        self.save_settings_button = QPushButton("Save Settings")
        self.save_settings_button.setObjectName("primaryButton")
        self.save_settings_button.clicked.connect(self.save_settings)

        self.settings_status = QLabel("")
        self.settings_status.setObjectName("mutedSmall")

        form.addWidget(title)
        form.addWidget(note)
        form.addSpacing(10)
        form.addWidget(key_label)
        form.addWidget(self.api_key_input)
        form.addWidget(model_label)
        form.addWidget(self.settings_model_combo)
        form.addSpacing(8)
        form.addWidget(self.save_settings_button, alignment=Qt.AlignRight)
        form.addWidget(self.settings_status)

        layout.addWidget(card)
        layout.addStretch()
        self.load_settings_into_form()
        return page

    def _top_header(self, title: str, subtitle: str) -> QFrame:
        frame = QFrame()
        frame.setObjectName("topHeader")
        layout = QHBoxLayout(frame)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(10)

        dots = QLabel("●  ●  ●")
        dots.setObjectName("windowDots")
        label = QLabel(f"{title}   {subtitle}")
        label.setObjectName("topHeaderText")
        self.status_label = getattr(self, "status_label", QLabel("Ready"))
        self.status_label.setObjectName("statusLabel")

        layout.addWidget(dots)
        layout.addWidget(label)
        layout.addStretch()
        layout.addWidget(self.status_label)
        return frame

    def _nav_button(self, text: str) -> QPushButton:
        button = QPushButton(text)
        button.setObjectName("navButton")
        button.setMinimumHeight(58)
        button.setCursor(Qt.PointingHandCursor)
        return button

    def _model_combo(self) -> QComboBox:
        combo = QComboBox()
        combo.setObjectName("modelCombo")
        combo.setEditable(True)
        combo.setInsertPolicy(QComboBox.NoInsert)
        combo.setMaxVisibleItems(11)
        combo.addItems(COMMON_MODELS)
        config = self.builder.load_config()
        combo.setCurrentText(config.get("default_model", "moonshotai/kimi-k2.6"))
        combo.lineEdit().setPlaceholderText("Choose or type an OpenRouter model id")
        return combo

    def show_page(self, index: int):
        self.stack.setCurrentIndex(index)
        self.nav_apps.setProperty("active", index == 0)
        self.nav_chat.setProperty("active", index == 1)
        self.nav_settings.setProperty("active", index == 2)
        for button in [self.nav_apps, self.nav_chat, self.nav_settings]:
            button.style().unpolish(button)
            button.style().polish(button)

    def reload_apps(self, select_first: bool = False):
        current = self.selected_app_id
        self.apps = self.builder.list_apps()
        self.app_list.blockSignals(True)
        self.app_list.clear()
        for app in self.apps:
            item = QListWidgetItem(f"{app.get('name', 'Untitled')}\n{app.get('updated_at', '')}")
            item.setData(Qt.UserRole, app.get("id"))
            self.app_list.addItem(item)
            if app.get("id") == current:
                self.app_list.setCurrentItem(item)
        self.app_list.blockSignals(False)

        if select_first and self.apps:
            self.select_app(self.apps[0]["id"])
        elif current:
            self.select_app(current)
        else:
            self.render_empty_chat()

    def select_app(self, app_id: str):
        app = self.builder.get_app(app_id)
        if not app:
            return
        self.selected_app_id = app_id
        for index in range(self.app_list.count()):
            item = self.app_list.item(index)
            if item.data(Qt.UserRole) == app_id:
                self.app_list.setCurrentItem(item)
                break
        self.render_selected_app(app)

    def on_app_selected(self, current: QListWidgetItem | None, _previous: QListWidgetItem | None):
        if not current:
            return
        app_id = current.data(Qt.UserRole)
        self.select_app(app_id)

    def render_selected_app(self, app: dict):
        self.chat_title.setText(app.get("name", "Untitled"))
        self.file_count_label.setText(f"{len(app.get('files', []))} files")
        self.files_list.clear()
        for rel_path in app.get("files", []):
            self.files_list.addItem(rel_path)
        self.render_chat(app)
        self.load_preview(app)

    def render_empty_chat(self):
        self.chat_title.setText("No app selected")
        self.chat_history.setHtml("<p style='color:#667085'>Create a new app to start chatting.</p>")
        self.preview.setHtml("<h2 style='font-family:sans-serif;color:#667085'>No preview yet</h2>")
        self.preview_status.setText("No preview loaded")
        self.files_list.clear()
        self.file_count_label.setText("0 files")

    def render_chat(self, app: dict):
        messages = app.get("messages", [])
        parts = [
            """
            <style>
              body { font-family: Inter, Segoe UI, sans-serif; background: transparent; }
              .msg { margin: 0 0 12px; padding: 12px 14px; border-radius: 14px; line-height: 1.48; }
              .user { background: #eef2ff; color: #172033; }
              .assistant { background: #ffffff; border: 1px solid #e4e7ec; color: #344054; }
              .role { font-size: 11px; font-weight: 800; text-transform: uppercase; color: #667085; margin-bottom: 6px; }
            </style>
            """
        ]
        for message in messages:
            role = message.get("role", "assistant")
            css = "user" if role == "user" else "assistant"
            label = "You" if role == "user" else "LocoCode"
            content = html_tools.escape(message.get("content", "")).replace("\n", "<br>")
            parts.append(f"<div class='msg {css}'><div class='role'>{label}</div>{content}</div>")
        self.chat_history.setHtml("".join(parts))
        self.chat_history.moveCursor(QTextCursor.End)

    def load_selected_preview(self):
        if not self.selected_app_id:
            return
        app = self.builder.get_app(self.selected_app_id)
        if app:
            self.load_preview(app)

    def load_preview(self, app: dict):
        preview_file = app.get("preview_file") or ""
        if not preview_file or not Path(preview_file).exists():
            self.preview.setHtml("<h2 style='font-family:sans-serif;color:#667085'>Preview file missing</h2>")
            self.preview_status.setText("Missing")
            return
        self.preview.load(QUrl.fromLocalFile(preview_file))
        self.preview_status.setText(Path(preview_file).name)

    def focus_new_app(self):
        self.show_page(0)
        self.home_prompt.setFocus()

    def create_from_home_prompt(self):
        prompt = self.home_prompt.toPlainText().strip()
        self.start_build("create", {"prompt": prompt, "model": self.model_combo.currentText(), "use_ai": True})

    def quick_create(self, prompt: str):
        self.home_prompt.setPlainText(prompt)
        self.create_from_home_prompt()

    def send_chat_prompt(self):
        prompt = self.chat_prompt.toPlainText().strip()
        if not self.selected_app_id:
            self.start_build("create", {"prompt": prompt, "model": self.model_combo.currentText(), "use_ai": True})
            return
        self.start_build(
            "rebuild",
            {
                "app_id": self.selected_app_id,
                "prompt": prompt,
                "model": self.model_combo.currentText(),
                "use_ai": True,
            },
        )

    def start_build(self, mode: str, payload: dict):
        if not payload.get("prompt"):
            QMessageBox.information(self, "Prompt mancante", "Scrivi cosa vuoi costruire o modificare.")
            return

        self.set_busy(True)
        self.status_label.setText("Generating... fallback after 35s")
        if mode == "create":
            self.build_button.setText("Generating...")
        else:
            self.chat_send_button.setText("Applying...")

        thread = QThread(self)
        worker = BuildWorker(self.builder, mode, payload)
        worker.moveToThread(thread)
        thread.started.connect(worker.run)
        worker.finished.connect(self.on_build_finished)
        worker.failed.connect(self.on_build_failed)
        worker.finished.connect(thread.quit)
        worker.failed.connect(thread.quit)
        worker.finished.connect(worker.deleteLater)
        worker.failed.connect(worker.deleteLater)
        thread.finished.connect(thread.deleteLater)
        thread.finished.connect(lambda: self._forget_thread(thread))
        self.active_threads.append(thread)
        thread.start()

    def on_build_finished(self, result: object):
        self.set_busy(False)
        data = result if isinstance(result, dict) else {}
        app = data.get("app")
        if app:
            self.home_prompt.clear()
            self.chat_prompt.clear()
            self.reload_apps()
            self.select_app(app["id"])
            self.show_page(1)
        self.status_label.setText("Ready")

    def on_build_failed(self, message: str):
        self.set_busy(False)
        self.status_label.setText("Error")
        QMessageBox.critical(self, "Errore LocoCode", message)

    def _forget_thread(self, thread: QThread):
        if thread in self.active_threads:
            self.active_threads.remove(thread)

    def set_busy(self, busy: bool):
        if self.is_busy == busy:
            return
        self.is_busy = busy
        for widget in [
            self.build_button,
            self.chat_send_button,
            self.new_app_button,
            self.save_settings_button,
        ]:
            widget.setEnabled(not busy)
        if busy:
            QApplication.setOverrideCursor(Qt.WaitCursor)
        else:
            QApplication.restoreOverrideCursor()
            self.build_button.setText("Generate")
            self.chat_send_button.setText("Apply Change")

    def open_selected_folder(self):
        if not self.selected_app_id:
            return
        app = self.builder.get_app(self.selected_app_id)
        if not app:
            return
        path = Path(app.get("path", ""))
        if path.exists():
            if os.name == "nt":
                os.startfile(path)
            else:
                QDesktopServices.openUrl(QUrl.fromLocalFile(str(path)))

    def load_settings_into_form(self):
        config = self.builder.load_config()
        self.api_key_input.setText(config.get("openrouter_api_key", ""))
        self.settings_model_combo.setCurrentText(config.get("default_model", "moonshotai/kimi-k2.6"))

    def save_settings(self):
        self.builder.save_config(
            self.api_key_input.text(),
            self.settings_model_combo.currentText(),
        )
        self.model_combo.setCurrentText(self.settings_model_combo.currentText())
        self.settings_status.setText("Settings saved locally.")
        self.status_label.setText("Settings saved")

    def _set_logo(self, label: QLabel, width: int, height: int):
        if LOGO_PATH.exists():
            pixmap = QPixmap(str(LOGO_PATH))
            if not pixmap.isNull():
                label.setPixmap(pixmap.scaled(width, height, Qt.KeepAspectRatio, Qt.SmoothTransformation))
                return
        label.setText("LC")

    def _apply_style(self):
        self.setStyleSheet(
            """
            QMainWindow {
                background: #f7f5ff;
            }
            #navRail {
                background: #f2effb;
                border-right: 1px solid #ded8ef;
            }
            #railLogo {
                border-radius: 16px;
                background: rgba(255,255,255,0.7);
            }
            #navButton {
                border: 0;
                border-radius: 14px;
                background: transparent;
                color: #485167;
                font-size: 13px;
                font-weight: 700;
                padding: 8px 4px;
            }
            #navButton:hover, #navButton[active="true"] {
                background: #dcd3ff;
                color: #1f2433;
            }
            #appsPanel {
                background: #f8f6ff;
                border-right: 1px solid #ded8ef;
            }
            #sectionTitle {
                color: #40465a;
                font-size: 13px;
                font-weight: 800;
            }
            #newAppButton, #secondaryButton, #quickButton {
                border: 1px solid #e4e1ef;
                border-radius: 10px;
                background: rgba(255,255,255,0.78);
                color: #242a3a;
                padding: 10px 12px;
                font-size: 13px;
                font-weight: 700;
            }
            #newAppButton:hover, #secondaryButton:hover, #quickButton:hover {
                border-color: #c9bfff;
                background: #ffffff;
            }
            #appList, #filesList {
                border: 0;
                background: transparent;
                outline: 0;
                color: #30384f;
                font-size: 13px;
            }
            #appList::item {
                border-radius: 10px;
                padding: 10px 10px;
                margin: 2px 0;
            }
            #appList::item:selected {
                background: #d8ccff;
                color: #1f2433;
            }
            #filesList {
                border: 1px solid #e4e7ec;
                border-radius: 12px;
                background: #ffffff;
                padding: 6px;
            }
            #filesList::item {
                padding: 5px 7px;
                border-radius: 7px;
            }
            #page {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:1,
                    stop:0 #fbfaff, stop:0.45 #f8f7ff, stop:1 #f6fbff);
            }
            #topHeader {
                min-height: 28px;
            }
            #windowDots {
                color: #ff7f6f;
                font-size: 11px;
                font-weight: 900;
            }
            #topHeaderText {
                color: #343a4d;
                font-size: 13px;
                font-weight: 800;
            }
            #statusLabel, #mutedSmall {
                color: #7a8194;
                font-size: 12px;
            }
            #heroLogo {
                margin-bottom: 4px;
            }
            #heroTitle {
                color: #121826;
                font-size: 48px;
                font-weight: 900;
                letter-spacing: 0;
            }
            #promptCard, #contentPanel, #settingsCard {
                background: rgba(255,255,255,0.86);
                border: 1px solid #e3e0ec;
                border-radius: 16px;
            }
            #promptInput, #chatPrompt {
                border: 0;
                background: transparent;
                color: #1f2433;
                font-size: 15px;
            }
            #promptInput:focus, #chatPrompt:focus {
                outline: 0;
            }
            #modelCombo {
                border: 1px solid #e4e1ef;
                border-radius: 9px;
                background: #ffffff;
                color: #3b4256;
                padding: 7px 10px;
                min-height: 34px;
                min-width: 210px;
                font-size: 12px;
                font-weight: 700;
            }
            QComboBox QAbstractItemView {
                background: #ffffff;
                color: #1f2433;
                border: 1px solid #d8dce7;
                border-radius: 10px;
                selection-background-color: #d8ccff;
                selection-color: #121826;
                outline: 0;
                padding: 6px;
            }
            QComboBox QAbstractItemView::item {
                min-height: 28px;
                padding: 6px 10px;
            }
            #primaryButton {
                border: 0;
                border-radius: 10px;
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #15aaff, stop:1 #ff2fb8);
                color: white;
                padding: 10px 16px;
                font-weight: 800;
                font-size: 13px;
            }
            #primaryButton:disabled {
                background: #cfd4df;
                color: #ffffff;
            }
            #quickButton {
                min-width: 150px;
            }
            #panelTitle {
                color: #141a2a;
                font-size: 18px;
                font-weight: 900;
            }
            #chatHistory {
                border: 1px solid #e4e7ec;
                border-radius: 12px;
                background: #fafbff;
                padding: 8px;
            }
            #preview {
                border-radius: 12px;
                background: #ffffff;
            }
            #mutedText {
                color: #667085;
                font-size: 14px;
                line-height: 1.5;
            }
            #fieldLabel {
                color: #3b4256;
                font-size: 12px;
                font-weight: 800;
            }
            #lineInput {
                border: 1px solid #d8dce7;
                border-radius: 10px;
                background: #ffffff;
                color: #1f2433;
                padding: 11px 12px;
                min-height: 38px;
            }
            QSplitter::handle {
                background: transparent;
                width: 12px;
            }
            """
        )
        self.show_page(0)

    def closeEvent(self, event):
        for thread in list(self.active_threads):
            thread.quit()
            thread.wait(1200)
        super().closeEvent(event)
