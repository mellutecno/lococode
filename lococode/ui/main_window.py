import json
import os
import re
import subprocess
from pathlib import Path

from PySide6.QtWidgets import (
    QDialog,
    QMainWindow,
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QTextEdit,
    QPushButton,
    QLabel,
    QComboBox,
    QFileDialog,
    QListWidget,
    QMessageBox,
    QInputDialog,
    QFrame,
    QSizePolicy,
    QMenu,
    QToolButton,
)
from PySide6.QtCore import Qt, QObject, QThread, Signal, Slot, QTimer
from PySide6.QtGui import QPixmap, QIcon

from lococode.core.agent_manager import AgentManager
from lococode.core.provider_manager import ProviderManager
from lococode.core.spec_manager import SpecManager
from lococode.core.project_workspace_manager import ProjectWorkspaceManager
from lococode.core.builder_engine import BuilderEngine
from lococode.core.backend_guard import BackendGuard
from lococode.ui.output_viewer_dialog import OutputViewerDialog
from lococode.ui.settings_dialog import SettingsDialog


APP_ROOT = Path.cwd()
ASSETS_DIR = APP_ROOT / "assets"


def find_asset(preferred_name, fallback_patterns, prefer_latest=False):
    candidates = []

    for pattern in fallback_patterns:
        candidates.extend(ASSETS_DIR.glob(pattern))

    preferred = ASSETS_DIR / preferred_name

    if preferred.exists():
        candidates.append(preferred)

    candidates = [
        p for p in candidates
        if p.is_file() and p.suffix.lower() in [".png", ".jpg", ".jpeg", ".webp"]
    ]

    if not candidates:
        return preferred

    unique = {}
    for item in candidates:
        unique[str(item.resolve())] = item

    candidates = list(unique.values())

    if prefer_latest:
        candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        return candidates[0]

    if preferred.exists():
        return preferred

    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0]


ICON_PATH = find_asset("lococode_icon.png", ["*icon*.png", "*logo*.png"], prefer_latest=False)

BANNER_PATH = find_asset(
    "lococode_banner.png",
    [
        "*banner*.png",
        "*banner*.jpg",
        "*banner*.jpeg",
        "*banner*.webp",
        "*header*.png",
        "*header*.jpg",
        "*header*.jpeg",
        "*header*.webp",
        "*loco*.png",
        "*loco*.jpg",
        "*loco*.jpeg",
        "*loco*.webp",
    ],
    prefer_latest=True
)

SIDEBAR_BANNER_PATH = ASSETS_DIR / "lococode_sidebar_banner.png"
BRAND_BANNER_PATH = ASSETS_DIR / "lococode_brand_banner.png"
IMAGE_ATTACHMENT_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}


class AIWorker(QObject):
    finished = Signal(str)
    error = Signal(str)

    def __init__(self, provider_manager, provider, model, agent, message, project_path):
        super().__init__()
        self.provider_manager = provider_manager
        self.provider = provider
        self.model = model
        self.agent = agent
        self.message = message
        self.project_path = project_path

    def run(self):
        try:
            response = self.provider_manager.send_message(
                provider_name=self.provider,
                model=self.model,
                agent=self.agent,
                user_message=self.message,
                project_path=self.project_path,
            )
            self.finished.emit(response)
        except Exception as e:
            self.error.emit(str(e))


class DictationWorker(QObject):
    finished = Signal(str)
    error = Signal(str)

    def run(self):
        script = r"""
Add-Type -AssemblyName System.Speech
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$grammar = New-Object System.Speech.Recognition.DictationGrammar
$recognizer.LoadGrammar($grammar)
$recognizer.SetInputToDefaultAudioDevice()
$result = $recognizer.Recognize([TimeSpan]::FromSeconds(8))
$recognizer.Dispose()
if ($result -and $result.Text) {
    Write-Output $result.Text
    exit 0
}
exit 2
""".strip()

        try:
            result = subprocess.run(
                ["powershell", "-NoProfile", "-STA", "-Command", script],
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=14,
            )

            text = (result.stdout or "").strip()

            if result.returncode == 0 and text:
                self.finished.emit(text)
                return

            error = (result.stderr or "").strip()
            if not error:
                error = "Non ho rilevato testo dal microfono. Controlla microfono e riconoscimento vocale di Windows."
            self.error.emit(error)
        except Exception as e:
            self.error.emit(str(e))


class PromptTextEdit(QTextEdit):
    send_requested = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAcceptRichText(False)

    def keyPressEvent(self, event):
        if event.key() in (Qt.Key_Return, Qt.Key_Enter):
            if event.modifiers() & Qt.ShiftModifier:
                super().keyPressEvent(event)
                return

            self.send_requested.emit()
            return

        super().keyPressEvent(event)


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()

        self.setWindowTitle("LocoCode")
        self.resize(1380, 820)
        self.setMinimumSize(980, 680)

        if ICON_PATH.exists():
            self.setWindowIcon(QIcon(str(ICON_PATH)))

        self.agent_manager = AgentManager()
        self.provider_manager = ProviderManager()
        self.spec_manager = SpecManager()
        self.workspace_manager = ProjectWorkspaceManager()
        self.builder_engine = BuilderEngine()
        self.backend_guard = BackendGuard()

        self.current_project_path = None
        self.last_ai_response = ""
        self.output_history_html = ""
        self.output_history_text = ""
        self.attached_files = []
        self.banner_original = QPixmap(str(BANNER_PATH)) if BANNER_PATH.exists() else None

        self.ai_thread = None
        self.ai_worker = None
        self.dictation_thread = None
        self.dictation_worker = None
        self.dictation_target = None
        self.dictation_button = None
        self.dictation_button_text = None

        self._build_ui()

    def _build_ui(self):
        central = QWidget()
        central.setObjectName("rootBackground")

        root_layout = QHBoxLayout(central)
        root_layout.setContentsMargins(10, 10, 14, 14)
        root_layout.setSpacing(14)

        # LEFT COLUMN
        left_col = QFrame()
        left_col.setObjectName("sideColumn")
        self.left_col = left_col
        self.left_sidebar_collapsed = True
        left_col.setMinimumWidth(70)
        left_col.setMaximumWidth(70)

        left_layout = QVBoxLayout(left_col)
        left_layout.setContentsMargins(8, 8, 8, 8)
        left_layout.setSpacing(8)

        self.logo_icon = QLabel()
        self.logo_icon.setObjectName("logoIcon")
        self.logo_icon.setFixedSize(30, 30)

        if ICON_PATH.exists():
            icon_pixmap = QPixmap(str(ICON_PATH))
            self.logo_icon.setPixmap(
                icon_pixmap.scaled(30, 30, Qt.KeepAspectRatio, Qt.SmoothTransformation)
            )
        else:
            self.logo_icon.setText("◇")
            self.logo_icon.setStyleSheet("font-size: 24px; color: #ff3ea5;")

        self.logo_icon.hide()
        self.logo_icon.setVisible(False)
        self.logo_icon.setMaximumSize(0, 0)

        self.sidebar_banner_label = QLabel()
        self.sidebar_banner_label.setObjectName("sidebarBanner")
        self.sidebar_banner_label.setFixedSize(270, 149)
        self.sidebar_banner_label.setAlignment(Qt.AlignCenter)

        if SIDEBAR_BANNER_PATH.exists():
            sidebar_banner = QPixmap(str(SIDEBAR_BANNER_PATH))
            self.sidebar_banner_label.setPixmap(
                sidebar_banner.scaled(270, 149, Qt.KeepAspectRatio, Qt.SmoothTransformation)
            )
        elif BANNER_PATH.exists():
            sidebar_banner = QPixmap(str(BANNER_PATH))
            self.sidebar_banner_label.setPixmap(
                sidebar_banner.scaled(270, 149, Qt.KeepAspectRatio, Qt.SmoothTransformation)
            )
        else:
            self.sidebar_banner_label.setText("LocoCode")

        self.sidebar_banner_label.hide()
        self.sidebar_banner_label.setVisible(False)
        self.sidebar_banner_label.setMaximumSize(0, 0)

        self.file_toggle_button = QPushButton("Menu")
        self.file_toggle_button.setObjectName("sideToggleButton")
        self.file_toggle_button.clicked.connect(self.toggle_file_panel)

        self.file_panel = QFrame()
        self.file_panel.setObjectName("sidePanel")
        self.file_panel.setVisible(False)

        file_panel_layout = QVBoxLayout(self.file_panel)
        file_panel_layout.setContentsMargins(12, 10, 12, 12)
        file_panel_layout.setSpacing(8)

        file_header = QHBoxLayout()

        file_title = QLabel("File progetto")
        file_title.setObjectName("panelTitle")

        close_files_button = QPushButton("×")
        close_files_button.setObjectName("miniCloseButton")
        close_files_button.setFixedSize(28, 28)
        close_files_button.clicked.connect(self.toggle_file_panel)

        file_header.addWidget(file_title)
        file_header.addStretch()
        file_header.addWidget(close_files_button)

        self.file_list = QListWidget()
        self.file_list.setObjectName("fileList")

        file_panel_layout.addLayout(file_header)
        file_panel_layout.addWidget(self.file_list, stretch=1)

        self.file_toggle_button.hide()
        self.file_toggle_button.setVisible(False)
        self.file_toggle_button.setMaximumHeight(0)

        self.sidebar_toggle_button = QPushButton("☰")
        self.sidebar_toggle_button.setObjectName("sidebarCollapseButton")
        self.sidebar_toggle_button.setToolTip("Menu LocoCode")
        if ICON_PATH.exists():
            self.sidebar_toggle_button.setIcon(QIcon(str(ICON_PATH)))
            self.sidebar_toggle_button.setText("")

        self.sidebar_new_project_button = QPushButton("＋ Nuovo progetto")
        self.sidebar_new_project_button.setObjectName("sideNavButton")
        self.sidebar_new_project_button.clicked.connect(self.create_new_ai_project)

        self.sidebar_open_project_button = QPushButton("⌕ Apri progetto")
        self.sidebar_open_project_button.setObjectName("sideNavButton")
        self.sidebar_open_project_button.clicked.connect(self.open_project_folder)

        self.sidebar_project_section = QLabel("Progetto")
        self.sidebar_project_section.setObjectName("sideSectionLabel")

        self.sidebar_project_name = QLabel("Nessun progetto")
        self.sidebar_project_name.setObjectName("sideProjectName")
        self.sidebar_project_name.setWordWrap(True)

        self.sidebar_file_project_button = QPushButton("▣ File progetto")
        self.sidebar_file_project_button.setObjectName("sideNavButton")
        self.sidebar_file_project_button.clicked.connect(self.toggle_file_panel)

        self.sidebar_work_section = QLabel("Lavoro")
        self.sidebar_work_section.setObjectName("sideSectionLabel")

        self.sidebar_save_project_button = QPushButton("💾 Salva progetto")
        self.sidebar_save_project_button.setObjectName("sideNavButton")
        self.sidebar_save_project_button.clicked.connect(self.save_current_spec)

        self.sidebar_next_step_button = QPushButton("→ Prossimo step")
        self.sidebar_next_step_button.setObjectName("sideNavButtonPrimary")
        self.sidebar_next_step_button.clicked.connect(self.run_next_step)

        self.sidebar_apply_button = QPushButton("✓ Applica modifiche")
        self.sidebar_apply_button.setObjectName("sideNavButton")
        self.sidebar_apply_button.clicked.connect(self.apply_last_ai_response_as_files)

        self.sidebar_verify_button = QPushButton("◇ Verifica progetto")
        self.sidebar_verify_button.setObjectName("sideNavButton")
        self.sidebar_verify_button.clicked.connect(self.repair_backend_basics)

        self.sidebar_chat_section = QLabel("Chat")
        self.sidebar_chat_section.setObjectName("sideSectionLabel")

        self.sidebar_chat_status = QLabel("Output sempre visibile")
        self.sidebar_chat_status.setObjectName("sideMutedLabel")

        self.sidebar_settings_button = QPushButton("⚙ Impostazioni")
        self.sidebar_settings_button.setObjectName("sideSettingsButton")
        self.sidebar_settings_button.clicked.connect(self.show_settings_placeholder)

        self.sidebar_expanded_widgets = [
            self.sidebar_new_project_button,
            self.sidebar_open_project_button,
            self.sidebar_project_section,
            self.sidebar_project_name,
            self.sidebar_file_project_button,
            self.sidebar_work_section,
            self.sidebar_save_project_button,
            self.sidebar_next_step_button,
            self.sidebar_apply_button,
            self.sidebar_verify_button,
            self.sidebar_chat_section,
            self.sidebar_chat_status,
            self.sidebar_settings_button,
        ]

        self.configure_icon_sidebar()

        left_layout.addWidget(self.sidebar_toggle_button, alignment=Qt.AlignLeft)
        left_layout.addWidget(self.sidebar_new_project_button)
        left_layout.addWidget(self.sidebar_open_project_button)
        left_layout.addSpacing(12)
        left_layout.addWidget(self.sidebar_project_section)
        left_layout.addWidget(self.sidebar_project_name)
        left_layout.addWidget(self.sidebar_file_project_button)
        left_layout.addSpacing(12)
        left_layout.addWidget(self.sidebar_work_section)
        left_layout.addWidget(self.sidebar_save_project_button)
        left_layout.addWidget(self.sidebar_next_step_button)
        left_layout.addWidget(self.sidebar_apply_button)
        left_layout.addWidget(self.sidebar_verify_button)
        left_layout.addSpacing(12)
        left_layout.addWidget(self.sidebar_chat_section)
        left_layout.addWidget(self.sidebar_chat_status)
        left_layout.addStretch(1)
        left_layout.addWidget(self.sidebar_settings_button)

        # CENTER COLUMN
        center_col = QWidget()
        center_layout = QVBoxLayout(center_col)
        center_layout.setContentsMargins(0, 0, 0, 0)
        center_layout.setSpacing(12)

        top_actions = QHBoxLayout()
        top_actions.setSpacing(8)

        self.project_label = QLabel("Nessun progetto")
        self.project_label.setObjectName("projectBadge")

        self.step_label = QLabel("Fase progetto: -")
        self.step_label.setObjectName("stepBadge")

        self.status_label = QLabel("Pronto")
        self.status_label.setObjectName("statusBadge")

        self.next_step_button = QPushButton("Prossimo step")
        self.next_step_button.setObjectName("nextStepButton")
        self.next_step_button.clicked.connect(self.run_next_step)

        self.new_project_button = QPushButton("Nuovo progetto AI")
        self.new_project_button.clicked.connect(self.create_new_ai_project)

        self.open_project_button = QPushButton("Apri progetto")
        self.open_project_button.clicked.connect(self.open_project_folder)

        self.save_spec_button = QPushButton("Salva SPEC")
        self.save_spec_button.clicked.connect(self.save_current_spec)
        self.save_spec_button.setEnabled(False)

        self.apply_output_button = QPushButton("Applica output")
        self.apply_output_button.clicked.connect(self.apply_last_ai_response_as_files)
        self.apply_output_button.setEnabled(False)

        self.repair_backend_button = QPushButton("Ripara backend")
        self.repair_backend_button.clicked.connect(self.repair_backend_basics)

        top_actions.addStretch()
        top_actions.addWidget(self.project_label)
        top_actions.addWidget(self.step_label)
        top_actions.addWidget(self.status_label)
        top_actions.addStretch()

        self.banner_label = QLabel()
        self.banner_label.setObjectName("mainBanner")
        self.banner_label.setAlignment(Qt.AlignCenter)
        self.banner_label.setMinimumSize(300, 100)
        self.banner_label.setMaximumSize(620, 220)
        self.banner_label.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)

        if self.banner_original:
            self.update_banner_pixmap()
        else:
            self.banner_label.setText("LocoCode")
            self.banner_label.setStyleSheet("font-size: 42px; font-weight: 900; color: white;")

        prompt_card = QFrame()
        prompt_card.setObjectName("lovablePromptCard")
        prompt_card.setMinimumWidth(760)
        prompt_card.setMaximumWidth(1120)
        prompt_card.setMinimumHeight(168)
        prompt_card.setMaximumHeight(188)
        prompt_card.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)

        prompt_layout = QVBoxLayout(prompt_card)
        prompt_layout.setContentsMargins(26, 16, 26, 14)
        prompt_layout.setSpacing(10)

        self.message_input = PromptTextEdit()
        self.message_input.setObjectName("lovablePromptInput")
        self.message_input.setMinimumHeight(86)
        self.message_input.setPlaceholderText("Ask LocoCode to create an app for...")
        self.message_input.send_requested.connect(self.send_message)

        controls_row = QHBoxLayout()
        controls_row.setSpacing(10)

        self.add_file_button = QPushButton("+")
        self.add_file_button.setObjectName("integratedPlusButton")
        self.add_file_button.setFixedSize(42, 42)
        self.add_file_button.clicked.connect(self.add_files_to_prompt)

        self.provider_combo = QComboBox()
        self.provider_combo.setObjectName("flatPromptCombo")
        self.provider_combo.setMinimumWidth(105)
        self.provider_combo.setMaximumWidth(120)
        self.provider_combo.addItem("OpenRouter", "OpenRouter")

        self.model_combo = QComboBox()
        self.model_combo.setObjectName("flatPromptCombo")
        self.model_combo.setMinimumWidth(122)
        self.model_combo.setMaximumWidth(150)

        self.agent_combo = QComboBox()
        self.agent_combo.setObjectName("flatPromptCombo")
        self.agent_combo.setMinimumWidth(145)
        self.agent_combo.setMaximumWidth(185)
        self.populate_agent_combo()

        self.mic_button = QPushButton("🎙")
        self.mic_button.setObjectName("integratedMicButton")
        self.mic_button.setFixedSize(42, 42)
        self.mic_button.setToolTip("Detta con il microfono")
        self.mic_button.clicked.connect(lambda: self.start_dictation(self.message_input, self.mic_button))

        self.send_button = QPushButton("↑")
        self.send_button.setObjectName("integratedSendButton")
        self.send_button.setFixedSize(46, 46)
        self.send_button.clicked.connect(self.send_message)

        controls_row.addWidget(self.add_file_button)
        controls_row.addStretch(1)
        controls_row.addWidget(self.provider_combo)
        controls_row.addWidget(self.model_combo)
        controls_row.addWidget(self.agent_combo)
        controls_row.addWidget(self.send_button)

        self.attachments_label = QLabel("")
        self.attachments_label.setObjectName("attachmentsLabel")
        self.attachments_label.setTextFormat(Qt.RichText)
        self.attachments_label.setWordWrap(True)
        self.attachments_label.setVisible(False)

        self.attachments_row = QHBoxLayout()
        self.attachments_row.setSpacing(8)
        self.attachments_row.setContentsMargins(0, 0, 0, 0)

        self.reference_hint_label = QLabel("")
        self.reference_hint_label.setObjectName("referenceHintLabel")
        self.reference_hint_label.setVisible(False)

        prompt_layout.addLayout(self.attachments_row)
        prompt_layout.addWidget(self.attachments_label)
        prompt_layout.addWidget(self.message_input)
        prompt_layout.addStretch(1)
        prompt_layout.addLayout(controls_row)

        self.banner_label.hide()
        self.banner_label.setVisible(False)
        self.banner_label.setMaximumHeight(0)

        self.brand_banner_label = QLabel()
        self.brand_banner_label.setObjectName("brandBanner")
        self.brand_banner_label.setAlignment(Qt.AlignCenter)
        self.brand_banner_label.setVisible(False)
        self.brand_banner_original = QPixmap(str(BRAND_BANNER_PATH)) if BRAND_BANNER_PATH.exists() else None

        self.work_status_label = QLabel("Pronto per il prossimo passaggio.")
        self.work_status_label.setObjectName("workStatusLabel")
        self.work_status_label.setAlignment(Qt.AlignLeft | Qt.AlignVCenter)
        self.work_status_label.setWordWrap(True)

        center_layout.addLayout(top_actions)
        center_layout.addStretch(1)
        center_layout.addWidget(prompt_card, alignment=Qt.AlignHCenter)
        center_layout.addStretch(2)

        # RIGHT COLUMN
        right_col = QFrame()
        right_col.setObjectName("sideColumn")
        self.right_col = right_col
        right_col.setMinimumWidth(170)
        right_col.setMaximumWidth(250)

        right_layout = QVBoxLayout(right_col)
        right_layout.setContentsMargins(0, 0, 0, 0)
        right_layout.setSpacing(12)

        self.big_output_button = QPushButton("Output grande")
        self.big_output_button.setObjectName("sideToggleButton")
        self.big_output_button.clicked.connect(self.open_big_output)

        self.output_toggle_button = QPushButton("Output")
        self.output_toggle_button.setObjectName("sideToggleButton")
        self.output_toggle_button.clicked.connect(self.toggle_output_panel)

        self.output_panel = QFrame()
        self.output_panel.setObjectName("sidePanel")
        self.output_panel.setVisible(False)

        output_layout = QVBoxLayout(self.output_panel)
        output_layout.setContentsMargins(12, 10, 12, 12)
        output_layout.setSpacing(8)

        output_header = QHBoxLayout()

        output_title = QLabel("Output")
        output_title.setObjectName("panelTitle")

        close_output_button = QPushButton("×")
        close_output_button.setObjectName("miniCloseButton")
        close_output_button.setFixedSize(28, 28)
        close_output_button.clicked.connect(self.toggle_output_panel)

        output_header.addWidget(output_title)
        output_header.addStretch()

        self.expand_output_button = QPushButton("⛶")
        self.expand_output_button.setObjectName("miniCloseButton")
        self.expand_output_button.setFixedSize(28, 28)
        self.expand_output_button.clicked.connect(self.open_big_output)

        output_header.addWidget(self.expand_output_button)
        output_header.addWidget(close_output_button)

        self.chat_area = QTextEdit()
        self.chat_area.setReadOnly(True)
        self.chat_area.setObjectName("chatOutput")

        output_layout.addLayout(output_header)
        output_layout.addWidget(self.chat_area, stretch=1)

        right_layout.addSpacing(42)
        right_layout.addWidget(self.output_toggle_button)
        right_layout.addWidget(self.output_panel, stretch=1)
        right_layout.addStretch(1)
        right_col.hide()
        right_col.setVisible(False)
        right_col.setMinimumWidth(0)
        right_col.setMaximumWidth(0)

        root_layout.addWidget(left_col)
        root_layout.addWidget(center_col, stretch=1)
        root_layout.addWidget(right_col)

        self.setCentralWidget(central)

        self.apply_style()
        self.update_model_list()
        self.set_default_selections()
        self.update_project_step_status()

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self.update_banner_pixmap()

    def update_banner_pixmap(self):
        if not self.banner_original:
            return

        size = self.banner_label.size()

        if size.width() <= 10 or size.height() <= 10:
            return

        scaled = self.banner_original.scaled(
            size.width(),
            size.height(),
            Qt.KeepAspectRatio,
            Qt.SmoothTransformation
        )
        self.banner_label.setPixmap(scaled)

    def build_left_icon_menu(self):
        menu = QMenu(self)

        project_menu = menu.addMenu("Progetto")
        project_menu.addAction("Apri progetto esistente", self.open_project_folder)
        project_menu.addAction("Nuovo progetto", self.create_new_ai_project)

        work_menu = menu.addMenu("Procedura")
        work_menu.addAction("1. Salva SDD iniziale", self.save_current_spec)
        work_menu.addAction("2. Prepara prossimo step", self.run_next_step)
        work_menu.addSeparator()
        work_menu.addAction("Dopo uno step: applica modifiche", self.apply_last_ai_response_as_files)
        work_menu.addAction("Poi verifica progetto", self.repair_backend_basics)
        work_menu.addAction("Poi salva avanzamento", self.save_current_spec)

        files_menu = menu.addMenu("File progetto")
        files_menu.addAction("Cartella progetto", self.toggle_file_panel)
        files_menu.addAction("SDD progetto", self.open_sdd_project_file)
        menu.addSeparator()
        settings_menu = menu.addMenu("Impostazioni")
        settings_menu.addAction("Chiave API OpenRouter", self.show_settings_placeholder)

        return menu

    def configure_icon_sidebar(self):
        self.left_sidebar_collapsed = True
        self.left_col.setMinimumWidth(70)
        self.left_col.setMaximumWidth(70)
        self.left_col.setStyleSheet("background: transparent; border: none;")

        for widget in self.sidebar_expanded_widgets:
            widget.hide()
            widget.setVisible(False)

        self.sidebar_toggle_button.setMenu(self.build_left_icon_menu())
        self.sidebar_toggle_button.setToolTip("Menu LocoCode")
        self.sidebar_toggle_button.show()
        self.sidebar_toggle_button.setVisible(True)

    def set_work_status(self, text):
        clean_text = (text or "").strip() or "Pronto per il prossimo passaggio."

        if hasattr(self, "work_status_label"):
            self.work_status_label.setText(clean_text)
            self.work_status_label.setToolTip(clean_text)

    def toggle_left_sidebar(self):
        self.left_sidebar_collapsed = not self.left_sidebar_collapsed

        if self.left_sidebar_collapsed:
            self.left_col.setMinimumWidth(54)
            self.left_col.setMaximumWidth(54)
            self.left_col.setStyleSheet("background: transparent; border: none;")
            self.sidebar_toggle_button.setText("☰")
            self.sidebar_toggle_button.setToolTip("Apri menu laterale")
            for widget in self.sidebar_expanded_widgets:
                widget.hide()
                widget.setVisible(False)
        else:
            self.left_col.setMinimumWidth(286)
            self.left_col.setMaximumWidth(286)
            self.left_col.setStyleSheet("")
            self.sidebar_toggle_button.setText("☰")
            self.sidebar_toggle_button.setToolTip("Chiudi menu laterale")
            for widget in self.sidebar_expanded_widgets:
                widget.show()
                widget.setVisible(True)

        self.refresh_prompt_layout_if_available()

    def show_settings_placeholder(self):
        dialog = SettingsDialog(self)
        dialog.exec()
        self.provider_manager = ProviderManager()

    def open_sdd_project_file(self):
        if not self.current_project_path:
            QMessageBox.warning(self, "Nessun progetto", "Apri prima un progetto.")
            return

        sdd_path = self.ensure_sdd_project_file()

        if not sdd_path:
            QMessageBox.warning(
                self,
                "SDD non trovato",
                "Non trovo ancora il file SDD salvato.\n\n"
                "Genera una risposta SDD e usa Salva progetto."
            )
            return

        try:
            content = sdd_path.read_text(encoding="utf-8", errors="ignore")
        except Exception as e:
            QMessageBox.critical(self, "Errore", f"Impossibile leggere l'SDD:\n{e}")
            return

        dialog = QDialog(self)
        dialog.setWindowTitle("SDD progetto")
        dialog.setWindowFlag(Qt.Window, True)
        dialog.setWindowFlag(Qt.WindowMinMaxButtonsHint, True)
        dialog.resize(920, 640)
        dialog.setMinimumSize(680, 430)

        layout = QVBoxLayout(dialog)
        layout.setContentsMargins(14, 14, 14, 14)
        layout.setSpacing(10)

        header = QHBoxLayout()
        title = QLabel("SDD progetto")
        close_button = QPushButton("Chiudi")
        close_button.clicked.connect(dialog.close)
        header.addWidget(title)
        header.addStretch()
        header.addWidget(close_button)

        viewer = QTextEdit()
        viewer.setReadOnly(True)
        viewer.setPlainText(content)

        layout.addLayout(header)
        layout.addWidget(viewer, stretch=1)

        dialog.setStyleSheet("""
            QDialog { background-color: #11101a; color: white; }
            QLabel { color: white; font-size: 18px; font-weight: 900; }
            QTextEdit {
                background-color: rgba(7, 10, 22, 0.96);
                color: #e7eeff;
                border: 1px solid rgba(255,255,255,0.12);
                border-radius: 16px;
                padding: 14px;
                font-family: Consolas, "Segoe UI", monospace;
                font-size: 14px;
            }
            QPushButton {
                background-color: rgba(255,255,255,0.08);
                color: white;
                border: 1px solid rgba(255,255,255,0.13);
                border-radius: 12px;
                padding: 8px 12px;
                font-weight: 800;
            }
            QPushButton:hover { background-color: rgba(255,255,255,0.16); }
        """)

        self.sdd_viewer_dialog = dialog
        dialog.show()
        dialog.raise_()
        dialog.activateWindow()

    def ensure_sdd_project_file(self):
        root = Path(self.current_project_path)
        sdd_path = root / ".lc" / "spec" / "sdd.md"

        if sdd_path.exists():
            return sdd_path

        candidates = [
            root / ".lc" / "logs" / "last_output.txt",
            root / ".lc" / "spec" / "requirements.md",
        ]

        for path in candidates:
            if not path.exists():
                continue

            content = path.read_text(encoding="utf-8", errors="ignore").strip()

            if not content:
                continue

            sdd_path.parent.mkdir(parents=True, exist_ok=True)
            sdd_path.write_text(
                "# SDD progetto\n\n"
                "Creato automaticamente da contenuto SDD già presente nel progetto.\n\n"
                "## Documento completo\n\n"
                + content
                + "\n",
                encoding="utf-8",
            )
            self.load_project_files(self.current_project_path)
            return sdd_path

        return None

    def populate_agent_combo(self):
        self.agent_combo.clear()
        aliases = {
            "SDD Orchestrator": "SDD Orchestrator",
            "Planner": "Planner",
            "Backend": "Backend",
            "Frontend": "Frontend",
            "Database": "Database",
            "Deploy Render": "Deploy",
            "Reviewer": "Reviewer",
        }

        for name in self.agent_manager.get_agent_names():
            self.agent_combo.addItem(aliases.get(name, name), name)

    def toggle_file_panel(self):
        visible = not self.file_panel.isVisible()
        self.file_panel.setVisible(visible)
        self.file_toggle_button.setText("Menu")

    def toggle_output_panel(self):
        self.output_panel.setVisible(True)

    def set_default_selections(self):
        provider = "OpenRouter"
        index = self.provider_combo.findData(provider)
        if index >= 0:
            self.provider_combo.setCurrentIndex(index)

        model = "deepseek/deepseek-v4-pro"
        index = self.model_combo.findData(model)
        if index >= 0:
            self.model_combo.setCurrentIndex(index)

        agent = "SDD Orchestrator"
        index = self.agent_combo.findData(agent)
        if index >= 0:
            self.agent_combo.setCurrentIndex(index)

    def update_model_list(self):
        models = [
            ("DeepSeek V4", "deepseek/deepseek-v4-pro"),
            ("DeepSeek Flash", "deepseek/deepseek-v4-flash"),
            ("Kimi K2.6", "moonshotai/kimi-k2.6"),
            ("Auto", "openrouter/auto"),
        ]

        current = self.model_combo.currentData() if hasattr(self, "model_combo") else ""

        self.model_combo.clear()

        for label, value in models:
            self.model_combo.addItem(label, value)

        if current:
            index = self.model_combo.findData(current)
            if index >= 0:
                self.model_combo.setCurrentIndex(index)

    def apply_style(self):
        self.setStyleSheet("""
            #rootBackground {
                background: qlineargradient(
                    x1:0, y1:0, x2:1, y2:1,
                    stop:0 #151515,
                    stop:0.20 #172a68,
                    stop:0.48 #6d3fe0,
                    stop:0.72 #cf2ca7,
                    stop:1 #ff3f36
                );
            }

            QMainWindow {
                background-color: #050816;
            }

            QWidget {
                color: #e6eefc;
                font-size: 13px;
            }

            #sideColumn {
                background-color: transparent;
                border: none;
                border-radius: 0px;
            }

            #logoIcon {
                background-color: transparent;
                border: none;
                padding: 0px;
                margin: 0px;
            }

            #logoText {
                color: white;
                font-size: 23px;
                font-weight: 900;
            }

            #sidebarBanner {
                background-color: rgba(8, 12, 24, 0.24);
                border: 1px solid rgba(255,255,255,0.10);
                border-radius: 16px;
                padding: 0px;
            }

            #projectBadge,
            #stepBadge,
            #statusBadge {
                color: #dbeafe;
                background-color: rgba(10, 14, 28, 0.48);
                border: 1px solid rgba(255,255,255,0.16);
                border-radius: 14px;
                padding: 8px 11px;
            }

            #nextStepButton {
                background-color: rgba(8, 12, 24, 0.58);
                border: 1px solid rgba(255,255,255,0.14);
                border-radius: 14px;
                padding: 8px 12px;
            }

            #mainBanner {
                background-color: transparent;
                border: none;
                border-radius: 0px;
            }

            #brandBanner {
                background-color: transparent;
                border: none;
                border-radius: 0px;
            }

            #lovablePromptCard {
                background-color: #242421;
                border: 1px solid rgba(255,255,255,0.12);
                border-radius: 28px;
            }

            #lovablePromptInput {
                background-color: #222321;
                color: #f1f5f9;
                border: none;
                border-radius: 18px;
                padding: 12px 6px;
                font-size: 16px;
                line-height: 1.35;
            }

            #lovablePromptInput:focus {
                border: none;
                outline: none;
            }

            #lovablePromptInput::placeholder {
                color: rgba(255,255,255,0.54);
            }

            QPushButton {
                background-color: rgba(255,255,255,0.14);
                color: white;
                border: 1px solid rgba(255,255,255,0.14);
                border-radius: 14px;
                padding: 8px 12px;
                font-weight: 800;
            }

            QPushButton:hover {
                background-color: rgba(255,255,255,0.23);
            }

            QPushButton:disabled {
                background-color: rgba(20,20,20,0.35);
                color: rgba(255,255,255,0.45);
            }

            #sideToggleButton {
                background-color: rgba(8, 12, 24, 0.52);
                border: 1px solid rgba(255,255,255,0.14);
                border-radius: 15px;
                padding: 9px 12px;
            }

            #sidebarCollapseButton {
                background-color: rgba(24, 24, 23, 0.68);
                color: rgba(255,255,255,0.82);
                border: none;
                border-radius: 16px;
                padding: 8px;
                font-size: 18px;
                font-weight: 900;
                min-width: 44px;
                max-width: 44px;
                min-height: 44px;
                max-height: 44px;
            }

            #sidebarCollapseButton:hover {
                background-color: rgba(255,255,255,0.12);
            }

            #workStatusLabel {
                background-color: transparent;
                color: rgba(255,255,255,0.62);
                border: none;
                font-size: 15px;
                font-weight: 700;
                padding: 0px 4px;
            }

            #sideSectionLabel {
                color: rgba(255,255,255,0.42);
                background: transparent;
                border: none;
                padding: 8px 4px 3px 4px;
                font-size: 13px;
                font-weight: 900;
            }

            #sideProjectName {
                color: rgba(255,255,255,0.78);
                background-color: rgba(255,255,255,0.055);
                border: 1px solid rgba(255,255,255,0.06);
                border-radius: 12px;
                padding: 9px 10px;
                font-size: 13px;
                font-weight: 800;
            }

            #sideMutedLabel {
                color: rgba(255,255,255,0.44);
                background: transparent;
                border: none;
                padding: 4px;
                font-size: 13px;
            }

            #sideNavButton,
            #sideNavButtonPrimary,
            #sideSettingsButton {
                text-align: left;
                background-color: transparent;
                color: rgba(255,255,255,0.78);
                border: none;
                border-radius: 11px;
                padding: 9px 10px;
                font-size: 14px;
                font-weight: 760;
            }

            #sideNavButton:hover,
            #sideSettingsButton:hover {
                background-color: rgba(255,255,255,0.08);
                color: white;
            }

            #sideNavButtonPrimary {
                background-color: rgba(255,255,255,0.10);
                color: white;
            }

            #sideNavButtonPrimary:hover {
                background-color: rgba(255,255,255,0.16);
            }

            #miniCloseButton {
                background-color: rgba(255,255,255,0.08);
                border: 1px solid rgba(255,255,255,0.10);
                border-radius: 14px;
                padding: 0px;
                font-size: 15px;
                font-weight: 900;
            }

            #integratedPlusButton {
                background-color: rgba(255,255,255,0.075);
                color: rgba(255,255,255,0.75);
                border: 1px solid rgba(255,255,255,0.05);
                border-radius: 21px;
                font-size: 21px;
                font-weight: 500;
                padding: 0px;
            }

            #integratedPlusButton:hover {
                background-color: rgba(255,255,255,0.12);
                color: white;
            }

            #integratedSendButton {
                background-color: rgba(255,255,255,0.64);
                color: #111827;
                border: none;
                border-radius: 23px;
                font-size: 22px;
                font-weight: 900;
                padding: 0px;
            }

            #integratedSendButton:hover {
                background-color: rgba(255,255,255,0.88);
            }

            #flatPromptCombo {
                background-color: #222321;
                color: rgba(255,255,255,0.62);
                border: none;
                border-radius: 13px;
                padding: 4px 18px 4px 8px;
                min-height: 30px;
                selection-background-color: #333333;
                font-weight: 700;
            }

            #flatPromptCombo:hover {
                color: rgba(255,255,255,0.92);
                background-color: rgba(255,255,255,0.035);
            }

            #flatPromptCombo::drop-down {
                subcontrol-origin: padding;
                subcontrol-position: top right;
                width: 16px;
                border: none;
                background-color: transparent;
            }

            #flatPromptCombo::down-arrow {
                image: none;
                width: 0px;
                height: 0px;
            }

            #flatPromptCombo QAbstractItemView {
                background-color: #202124;
                color: white;
                border: 1px solid rgba(255,255,255,0.14);
                selection-background-color: #333333;
                outline: none;
            }

            QLabel {
                color: rgba(255,255,255,0.82);
            }

            #sidePanel {
                background-color: rgba(6, 10, 26, 0.78);
                border: 1px solid rgba(255,255,255,0.13);
                border-radius: 18px;
            }

            #panelTitle {
                color: #eaf2ff;
                font-weight: 900;
                font-size: 15px;
            }

            #attachmentsLabel {
                color: transparent;
                background: transparent;
                border: none;
                font-size: 0px;
                max-height: 0px;
                padding: 0px;
            }

            #attachmentChip {
                background-color: rgba(255,255,255,0.075);
                border: 1px solid rgba(255,255,255,0.10);
                border-radius: 13px;
            }

            #attachmentPreview {
                background-color: rgba(0,0,0,0.24);
                color: rgba(255,255,255,0.72);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 9px;
                font-size: 10px;
                font-weight: 900;
            }

            #attachmentChipName {
                color: rgba(255,255,255,0.78);
                background: transparent;
                border: none;
                font-size: 12px;
                font-weight: 800;
            }

            #attachmentRemoveButton {
                background-color: rgba(255,255,255,0.08);
                color: rgba(255,255,255,0.82);
                border: none;
                border-radius: 11px;
                padding: 0px;
                font-size: 15px;
                font-weight: 900;
            }

            #attachmentRemoveButton:hover {
                background-color: rgba(255,255,255,0.18);
                color: white;
            }

            #referenceHintLabel {
                color: rgba(255,255,255,0.72);
                background: transparent;
                border: none;
                font-size: 13px;
                font-weight: 800;
                padding: 0px 6px 2px 6px;
            }

            QTextEdit {
                background-color: rgba(8, 13, 31, 0.72);
                color: #f5f7fb;
                border: 1px solid rgba(255,255,255,0.10);
                border-radius: 14px;
                padding: 10px;
            }

            QListWidget {
                background-color: rgba(8, 13, 31, 0.72);
                color: #dbeafe;
                border: 1px solid rgba(255,255,255,0.10);
                border-radius: 14px;
                padding: 7px;
            }

            QListWidget::item {
                padding: 5px;
                border-radius: 7px;
            }

            QListWidget::item:selected {
                background-color: #1d4ed8;
                color: white;
            }
        """)

    def add_files_to_prompt(self):
        files, _ = QFileDialog.getOpenFileNames(
            self,
            "Aggiungi file al prompt",
            self.current_project_path or str(Path.home()),
            "File supportati (*.py *.js *.jsx *.ts *.tsx *.html *.css *.json *.md *.txt *.yaml *.yml *.env *.toml *.png *.jpg *.jpeg *.webp *.gif *.bmp);;Immagini (*.png *.jpg *.jpeg *.webp *.gif *.bmp);;File di testo e codice (*.py *.js *.jsx *.ts *.tsx *.html *.css *.json *.md *.txt *.yaml *.yml *.env *.toml);;Tutti i file (*.*)"
        )

        if not files:
            return

        for file in files:
            if file not in self.attached_files:
                self.attached_files.append(file)

        self.update_attachments_label()

    def update_attachments_label(self):
        self.rebuild_attachment_chips()

        if not self.attached_files:
            self.attachments_label.setVisible(False)
            self.attachments_label.setText("")
            self.refresh_prompt_layout_if_available()
            return

        chips = []

        for file in self.attached_files:
            path = Path(file)
            safe_name = self.escape_html(path.name)

            if path.suffix.lower() in IMAGE_ATTACHMENT_EXTENSIONS and path.exists():
                try:
                    src = path.resolve().as_uri()
                    chips.append(
                        "<span style='display:inline-block; margin-right:8px;'>"
                        f"<img src='{src}' width='74' height='48' "
                        "style='object-fit:cover; border-radius:10px; border:1px solid rgba(255,255,255,0.18);'>"
                        f"<br><span style='font-size:11px; color:rgba(255,255,255,0.72);'>{safe_name}</span>"
                        "</span>"
                    )
                except Exception:
                    chips.append(f"<span style='color:rgba(255,255,255,0.72);'>{safe_name}</span>")
            else:
                chips.append(
                    "<span style='display:inline-block; padding:4px 8px; margin-right:6px; "
                    "border-radius:10px; background-color:rgba(255,255,255,0.08); "
                    f"color:rgba(255,255,255,0.78);'>{safe_name}</span>"
                )

        self.attachments_label.setText("".join(chips))
        self.attachments_label.setVisible(True)
        self.refresh_prompt_layout_if_available()

    def clear_layout_items(self, layout):
        if layout is None:
            return

        while layout.count():
            item = layout.takeAt(0)
            child_layout = item.layout()
            widget = item.widget()

            if child_layout is not None:
                self.clear_layout_items(child_layout)

            if widget is not None:
                widget.hide()
                widget.setParent(None)
                widget.deleteLater()

    def rebuild_attachment_chips(self):
        layout = getattr(self, "attachments_row", None)

        if layout is None:
            return

        self.clear_layout_items(layout)

        if not self.attached_files:
            return

        for file in self.attached_files:
            path = Path(file)
            chip = QFrame()
            chip.setObjectName("attachmentChip")
            chip_layout = QHBoxLayout(chip)
            chip_layout.setContentsMargins(8, 6, 6, 6)
            chip_layout.setSpacing(6)

            preview = QLabel()
            preview.setObjectName("attachmentPreview")
            preview.setFixedSize(42, 32)
            preview.setAlignment(Qt.AlignCenter)

            if path.suffix.lower() in IMAGE_ATTACHMENT_EXTENSIONS and path.exists():
                pixmap = QPixmap(str(path))
                if not pixmap.isNull():
                    preview.setPixmap(
                        pixmap.scaled(42, 32, Qt.KeepAspectRatioByExpanding, Qt.SmoothTransformation)
                    )
                else:
                    preview.setText("IMG")
            else:
                preview.setText(path.suffix.lower().replace(".", "").upper() or "FILE")

            name = QLabel(path.name)
            name.setObjectName("attachmentChipName")
            name.setMaximumWidth(150)
            name.setToolTip(str(path))

            remove_button = QToolButton()
            remove_button.setObjectName("attachmentRemoveButton")
            remove_button.setText("×")
            remove_button.setToolTip("Rimuovi allegato")
            remove_button.setFixedSize(22, 22)
            remove_button.clicked.connect(lambda checked=False, value=file: self.remove_attachment(value))

            chip_layout.addWidget(preview)
            chip_layout.addWidget(name)
            chip_layout.addWidget(remove_button)
            layout.addWidget(chip)

        layout.addStretch(1)

    def remove_attachment(self, file_path):
        self.attached_files = [file for file in self.attached_files if file != file_path]
        self.update_attachments_label()

    def refresh_prompt_layout_if_available(self):
        try:
            refresh = getattr(self, "refresh_compact_layout", None)
            if refresh is not None:
                refresh()
        except Exception:
            pass

    def build_message_with_attachments(self, message):
        if not self.attached_files:
            return message

        parts = [message, "\n\n--- FILE ALLEGATI AL PROMPT ---"]

        for file in self.attached_files:
            path = Path(file)

            if path.suffix.lower() in IMAGE_ATTACHMENT_EXTENSIONS:
                parts.append(
                    f"\n\n## {path.name}\nPercorso: {path}\n"
                    "[Immagine allegata: usa il percorso come riferimento visivo.]"
                )
                continue

            try:
                content = path.read_text(encoding="utf-8", errors="ignore")
            except Exception as e:
                content = f"[Impossibile leggere il file: {e}]"

            max_chars = 12000

            if len(content) > max_chars:
                content = content[:max_chars] + "\n\n[FILE TRONCATO: troppo lungo]"

            parts.append(
                f"\n\n## {path.name}\nPercorso: {path}\n\n```text\n{content}\n```"
            )

        return "".join(parts)

    def clear_attachments(self):
        self.attached_files = []
        self.update_attachments_label()

    def escape_html(self, text):
        if text is None:
            text = ""

        safe_text = str(text)
        safe_text = safe_text.replace("&", "&amp;")
        safe_text = safe_text.replace("<", "&lt;")
        safe_text = safe_text.replace(">", "&gt;")
        safe_text = safe_text.replace("\n", "<br>")
        return safe_text

    def sanitize_chat_history(self):
        """Ripulisce vecchi prompt tecnici finiti per errore nella chat."""
        markers = [
            "CONTESTO PROGETTO:",
            "Sei LocoCode in modalit",
            "STATO RILEVATO:",
            "# ALBERO PROGETTO",
        ]

        html = self.output_history_html or ""
        if html:
            compact_step = self.make_chat_block("user", "Prossimo step")

            def replace_internal_prompt(match):
                block = match.group(0)
                if any(marker in block for marker in markers):
                    return compact_step
                return block

            html = re.sub(
                r"<table width='100%' cellspacing='0' cellpadding='0' style='margin-top:8px; margin-bottom:12px;'>.*?</table>\s*</td>\s*</tr>\s*</table>",
                replace_internal_prompt,
                html,
                flags=re.DOTALL,
            )
            html = re.sub(
                r"<div style='font-size:11px;[^>]*>(?:Tu|LocoCode)</div>",
                "",
                html,
                flags=re.DOTALL,
            )
            html = html.replace(" bgcolor='#242421'", "")
            html = html.replace(" bgcolor='#2f2d2a'", "")
            html = re.sub(r"border:1px solid #[0-9a-fA-F]{6};\s*", "", html)
            html = html.replace("<table width='96%' cellspacing='0' cellpadding='0'>", "<table width='100%' cellspacing='0' cellpadding='0'>")
            self.output_history_html = html

        text = self.output_history_text or ""
        if text:
            lines = text.splitlines()
            cleaned = []
            skip_internal = False

            for line in lines:
                if line == "TU:":
                    skip_internal = False
                    cleaned.append(line)
                    continue

                if any(marker in line for marker in markers):
                    if cleaned and cleaned[-1] == "TU:":
                        cleaned.append("Prossimo step")
                    skip_internal = True
                    continue

                if skip_internal:
                    if line in {"LOCOCODE:", "SISTEMA:"}:
                        skip_internal = False
                        cleaned.append("")
                        cleaned.append(line)
                    continue

                cleaned.append(line)

            self.output_history_text = "\n".join(cleaned).strip() + ("\n\n" if cleaned else "")

    def render_chat_history(self):
        if not hasattr(self, "chat_area"):
            return

        self.sanitize_chat_history()

        html = (
            "<html><body style='background:#1f1f1d; color:#f5f7fb; "
            "font-family:Segoe UI, Arial, sans-serif; font-size:14px;'>"
            + (self.output_history_html or "")
            + "</body></html>"
        )
        self.chat_area.setHtml(html)
        self.scroll_chat_to_bottom()
        QTimer.singleShot(0, self.scroll_chat_to_bottom)

    def make_chat_block(self, role, text):
        safe_text = self.escape_html(text)

        if role == "user":
            return (
                "<table width='100%' cellspacing='0' cellpadding='0' style='margin-top:8px; margin-bottom:12px;'>"
                "<tr>"
                "<td width='28%'>&nbsp;</td>"
                "<td align='right'>"
                "<table cellspacing='0' cellpadding='0' style='max-width:72%;'>"
                "<tr><td style='color:#f7f7f2; "
                "padding:8px 2px 8px 12px; line-height:1.42;'>"
                f"{safe_text}"
                "</td></tr></table>"
                "</td>"
                "</tr></table>"
            )

        if role == "system":
            return (
                "<table width='100%' cellspacing='0' cellpadding='0' style='margin-top:8px; margin-bottom:10px;'>"
                "<tr><td align='center'>"
                "<span style='color:#c9c2b8; font-size:12px;'>"
                f"{safe_text}"
                "</span>"
                "</td></tr></table>"
            )

        return (
            "<div style='width:100%; color:#f5f7fb; padding:8px 2px 14px 2px; "
            "line-height:1.45;'>"
            f"{safe_text}"
            "</div>"
        )

    def is_large_sdd_response(self, text):
        content = text or ""

        if len(content) > 2400:
            return True

        markers = [
            "# Requirements",
            "# Architecture",
            "# Tasks",
            "## Requisiti",
            "## Architettura",
            "## Piano",
            "## Task",
            "SDD",
        ]
        return sum(1 for marker in markers if marker.lower() in content.lower()) >= 2

    def build_ai_chat_preview(self, text):
        if not self.is_large_sdd_response(text):
            return text

        return (
            "Ho preparato l'SDD del progetto.\n\n"
            "Non lo lascio tutto dentro la chat: resta disponibile come risultato corrente. "
            "Usa `Salva progetto` per scriverlo nei file `.lc/spec`, poi lo puoi riaprire da `File progetto`.\n\n"
            "Prossimo passo consigliato: salva il progetto e poi usa `Prossimo step`."
        )

    def build_workflow_hint(self, response):
        content = response or ""

        try:
            has_file_ops = self.builder_engine.has_file_operations(content)
        except Exception:
            has_file_ops = False

        if has_file_ops:
            return (
                "Ho preparato modifiche applicabili ai file. "
                "Ordine consigliato: Applica modifiche -> Verifica progetto -> "
                "Salva avanzamento -> Prossimo step."
            )

        if self.is_large_sdd_response(content):
            return (
                "Ho preparato l'SDD iniziale. "
                "Ordine consigliato: Salva SDD iniziale -> Prossimo step."
            )

        return (
            "Ho completato questa risposta. "
            "Se contiene decisioni utili, salva l'avanzamento; se serve continuare, usa Prossimo step."
        )

    def add_system_message(self, text):
        clean_text = (text or "").strip()

        if not clean_text:
            return

        self.set_work_status(clean_text)
        self.output_history_html += self.make_chat_block("system", clean_text)
        self.output_history_text += "SISTEMA:\n" + clean_text + "\n\n"
        self.render_chat_history()
        self.save_output_history()

    def add_user_message(self, text):
        clean_text = (text or "").strip()

        if not clean_text:
            if self.attached_files:
                names = ", ".join(Path(file).name for file in self.attached_files)
                clean_text = f"Allegati: {names}"
            else:
                return

        html_block = self.make_chat_block("user", clean_text)

        self.output_history_html += html_block
        self.output_history_text += "TU:\n" + clean_text + "\n\n"

        self.render_chat_history()
        self.save_output_history()


    def get_output_log_paths(self):
        if not self.current_project_path:
            return None, None

        root = Path(self.current_project_path)
        logs_dir = root / ".lc" / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)

        return logs_dir / "last_output.html", logs_dir / "last_output.txt"

    def save_output_history(self):
        html_path, txt_path = self.get_output_log_paths()

        if not html_path or not txt_path:
            return

        try:
            html_path.write_text(self.output_history_html or "", encoding="utf-8")
            txt_path.write_text(self.output_history_text or "", encoding="utf-8")
        except Exception:
            pass

    def load_output_history(self):
        html_path, txt_path = self.get_output_log_paths()

        self.output_history_html = ""
        self.output_history_text = ""

        if html_path and html_path.exists():
            try:
                self.output_history_html = html_path.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                self.output_history_html = ""

        if txt_path and txt_path.exists():
            try:
                self.output_history_text = txt_path.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                self.output_history_text = ""

        if hasattr(self, "chat_area"):
            self.chat_area.clear()
            self.set_work_status("Progetto aperto. SDD e output salvati sono disponibili da File progetto.")

    def open_big_output(self):
        html_content = self.output_history_html or ""
        plain_content = self.output_history_text or ""

        if not html_content and hasattr(self, "chat_area"):
            html_content = self.chat_area.toHtml()
            plain_content = self.chat_area.toPlainText()

        dialog = OutputViewerDialog(
            parent=self,
            html_content=html_content,
            plain_content=plain_content,
        )
        dialog.exec()

    def add_ai_message(self, text):
        display_text = self.build_ai_chat_preview(text)
        html_block = self.make_chat_block("ai", display_text)

        self.output_history_html += html_block
        self.output_history_text += "LOCOCODE:\n" + (display_text or "") + "\n\n"

        self.render_chat_history()
        self.save_output_history()

    def scroll_chat_to_bottom(self):
        scrollbar = self.chat_area.verticalScrollBar()
        scrollbar.setValue(scrollbar.maximum())

    def start_dictation(self, target_widget, button=None):
        if self.dictation_thread is not None:
            return

        self.dictation_target = target_widget
        self.dictation_button = button
        self.dictation_button_text = button.text() if button is not None else None

        if button is not None:
            button.setEnabled(False)
            button.setText("…")

        if hasattr(self, "status_label"):
            self.status_label.setText("Ascolto...")

        self.dictation_thread = QThread()
        self.dictation_worker = DictationWorker()
        self.dictation_worker.moveToThread(self.dictation_thread)

        self.dictation_thread.started.connect(self.dictation_worker.run)
        self.dictation_worker.finished.connect(self.on_dictation_finished)
        self.dictation_worker.error.connect(self.on_dictation_error)
        self.dictation_worker.finished.connect(self.dictation_thread.quit)
        self.dictation_worker.error.connect(self.dictation_thread.quit)
        self.dictation_thread.finished.connect(self.cleanup_dictation_thread)
        self.dictation_thread.start()

    def on_dictation_finished(self, text):
        target = self.dictation_target

        if target is not None and text:
            try:
                if hasattr(target, "insertPlainText"):
                    target.insertPlainText((text.strip() + " "))
                elif hasattr(target, "setText") and hasattr(target, "text"):
                    current = target.text().strip()
                    target.setText((current + " " + text.strip()).strip())
            except Exception:
                pass

        if hasattr(self, "status_label"):
            self.status_label.setText("Dettato inserito")

    def on_dictation_error(self, error_message):
        if hasattr(self, "status_label"):
            self.status_label.setText("Pronto")

        QMessageBox.warning(
            self,
            "Dettatura non disponibile",
            "Non sono riuscito a trascrivere dal microfono.\n\n"
            f"Dettaglio:\n{error_message}"
        )

    def cleanup_dictation_thread(self):
        if self.dictation_button is not None:
            self.dictation_button.setEnabled(True)
            self.dictation_button.setText(self.dictation_button_text or "🎙")

        self.dictation_worker = None
        self.dictation_thread = None
        self.dictation_target = None
        self.dictation_button = None
        self.dictation_button_text = None

    def send_message(self):
        message = self.message_input.toPlainText().strip()

        if not message and not self.attached_files:
            return

        self.send_text_message(message)

    def send_text_message(self, message, display_message=None):
        if self.ai_thread is not None:
            return

        provider = self.provider_combo.currentData() or self.provider_combo.currentText()
        model = self.model_combo.currentData() or self.model_combo.currentText()
        agent_name = self.agent_combo.currentData() or self.agent_combo.currentText()
        agent = self.agent_manager.get_agent_by_name(agent_name)

        final_message = self.build_message_with_attachments(message)
        if self.current_project_path:
            final_message = final_message + "\n\n" + self.builder_engine.get_ai_instructions()

        self.add_user_message(display_message if display_message is not None else message)

        self.message_input.clear()
        self.clear_attachments()

        self.send_button.setEnabled(False)
        self.message_input.setEnabled(False)
        self.send_button.setText("…")

        if hasattr(self, "status_label"):
            self.status_label.setText("In attesa...")

        if hasattr(self, "output_panel") and not self.output_panel.isVisible():
            self.toggle_output_panel()

        self.add_system_message("LocoCode sta lavorando... preparo il prossimo passaggio.")


        if not self.output_panel.isVisible():
            self.toggle_output_panel()

        self.ai_thread = QThread()
        self.ai_worker = AIWorker(
            provider_manager=self.provider_manager,
            provider=provider,
            model=model,
            agent=agent,
            message=final_message,
            project_path=self.current_project_path,
        )

        self.ai_worker.moveToThread(self.ai_thread)

        self.ai_thread.started.connect(self.ai_worker.run)
        self.ai_worker.finished.connect(self.handle_ai_finished, Qt.QueuedConnection)
        self.ai_worker.error.connect(self.handle_ai_error, Qt.QueuedConnection)

        self.ai_worker.finished.connect(self.ai_thread.quit)
        self.ai_worker.error.connect(self.ai_thread.quit)
        self.ai_thread.finished.connect(self.cleanup_ai_thread)

        self.ai_thread.start()

    @Slot(str)
    def handle_ai_finished(self, response):
        self.on_ai_finished(response)

    @Slot(str)
    def handle_ai_error(self, error_message):
        self.on_ai_error(error_message)

    def on_ai_finished(self, response):
        self.last_ai_response = response or ""
        self.save_spec_button.setEnabled(bool(self.last_ai_response.strip()))
        if hasattr(self, "apply_output_button"):
            self.apply_output_button.setEnabled(self.builder_engine.has_file_operations(self.last_ai_response))
        self.add_ai_message(response)
        self.add_system_message(self.build_workflow_hint(response))
        self.enable_input()
        if hasattr(self, "status_label"):
            self.status_label.setText("Risposta pronta")

        self.update_project_step_status()

    def on_ai_error(self, error_message):
        self.add_ai_message(f"Errore durante l'elaborazione:\n{error_message}")
        self.enable_input()
        if hasattr(self, "status_label"):
            self.status_label.setText("Errore")
        self.set_work_status("Errore durante il lavoro. Controlla il messaggio nella chat.")

    def cleanup_ai_thread(self):
        self.ai_worker = None
        self.ai_thread = None

    def enable_input(self):
        self.send_button.setEnabled(True)
        self.message_input.setEnabled(True)
        self.send_button.setText("↑")
        self.message_input.setFocus()

    def get_project_root(self):
        if not self.current_project_path:
            return None
        return Path(self.current_project_path)

    def update_project_label(self):
        if not self.current_project_path:
            self.project_label.setText("Nessun progetto")
            self.project_label.setToolTip("")
            if hasattr(self, "sidebar_project_name"):
                self.sidebar_project_name.setText("Nessun progetto")
                self.sidebar_project_name.setToolTip("")
            return

        project_path = Path(self.current_project_path)
        project_name = self.get_project_display_name(project_path)
        self.project_label.setText(project_name)
        self.project_label.setToolTip(str(project_path))

        if hasattr(self, "sidebar_project_name"):
            self.sidebar_project_name.setText(project_name)
            self.sidebar_project_name.setToolTip(str(project_path))

    def get_project_display_name(self, project_path):
        project_path = Path(project_path)
        metadata_path = project_path / ".lc" / "project.json"

        if metadata_path.exists():
            try:
                data = json.loads(metadata_path.read_text(encoding="utf-8"))
                display_name = str(data.get("display_name", "")).strip()
                if display_name:
                    return display_name
            except Exception:
                pass

        readme_path = project_path / "README.md"
        if readme_path.exists():
            try:
                for line in readme_path.read_text(encoding="utf-8", errors="ignore").splitlines():
                    line = line.strip()
                    if line.startswith("# "):
                        name = line[2:].strip()
                        if name:
                            return name
            except Exception:
                pass

        return project_path.name or "Progetto"

    def resolve_project_folder(self, folder):
        folder_path = Path(folder)

        if (folder_path / ".lc").exists():
            return str(folder_path)

        try:
            project_children = [
                child for child in folder_path.iterdir()
                if child.is_dir() and (child / ".lc").exists()
            ]
        except Exception:
            project_children = []

        if len(project_children) == 1:
            return str(project_children[0])

        return str(folder_path)

    def update_project_step_status(self):
        root = self.get_project_root()

        if not root:
            self.step_label.setText("Fase progetto: -")
            return

        status = self.detect_next_step(root)
        self.step_label.setText(status)

    def detect_next_step(self, root):
        lc_dir = root / ".lc"

        state_files = [
            lc_dir / "task_state.json",
            lc_dir / "state.json",
            lc_dir / "progress.json",
            lc_dir / "task_progress.json",
        ]

        for state_file in state_files:
            if not state_file.exists():
                continue

            try:
                data = json.loads(state_file.read_text(encoding="utf-8"))
            except Exception:
                continue

            for key in ["next_task", "next_step"]:
                if key in data:
                    return f"Prossimo: {data[key]}"

            for key in ["completed_task", "last_completed_task", "task_completed", "completed"]:
                if key in data:
                    try:
                        return f"Prossimo: {int(data[key]) + 1}"
                    except Exception:
                        return f"Completato: {data[key]}"

        task_files = [
            lc_dir / "spec" / "tasks.md",
            lc_dir / "tasks.md",
            root / "tasks.md",
        ]

        for task_file in task_files:
            if not task_file.exists():
                continue

            text = task_file.read_text(encoding="utf-8", errors="ignore")
            next_line = self.find_first_unchecked_task(text)

            if next_line:
                return "Prossimo: SPEC"

            if text.strip():
                return "SPEC pronta"

        return "Step: da generare"

    def find_first_unchecked_task(self, text):
        for raw_line in text.splitlines():
            line = raw_line.strip()

            if line.startswith("- [ ]") or line.startswith("* [ ]"):
                return line

            if "|" in line and not line.lower().startswith("|---"):
                cells = [c.strip() for c in line.strip("|").split("|")]
                if cells and any(c.lower() in ["todo", "da fare", "pending", "non fatto"] for c in cells):
                    return line

        return ""

    def collect_project_context_for_next_step(self, root):
        paths = [
            root / ".lc" / "spec" / "requirements.md",
            root / ".lc" / "spec" / "architecture.md",
            root / ".lc" / "spec" / "tasks.md",
            root / ".lc" / "memory" / "project_context.md",
        ]

        chunks = []

        for path in paths:
            if path.exists():
                content = path.read_text(encoding="utf-8", errors="ignore")
                chunks.append(f"\n\n# FILE: {path.relative_to(root)}\n{content[:12000]}")

        if not chunks:
            return ""

        return "".join(chunks)

    def run_next_step(self):
        root = self.get_project_root()

        if not root:
            QMessageBox.warning(self, "Nessun progetto", "Apri un progetto prima di usare Prossimo step.")
            return

        context = self.collect_project_context_for_next_step(root)

        if not context:
            QMessageBox.warning(
                self,
                "SPEC non trovata",
                "Non trovo file SPEC nella cartella .lc. Prima genera o salva una SPEC."
            )
            return

        agent_index = self.agent_combo.findData("SDD Orchestrator")
        if agent_index >= 0:
            self.agent_combo.setCurrentIndex(agent_index)

        prompt = (
            "Sei LocoCode in modalitÃ  SDD Orchestrator. "
            "Leggi la SPEC e i task del progetto qui sotto. "
            "Identifica il prossimo step non completato e prepara l'azione successiva in modo operativo. "
            "Non usare logica Trello hardcoded: lavora in modo generico sul progetto aperto. "
            "Rispondi con: prossimo step, file da creare/modificare, contenuto o istruzioni operative.\n"
            f"{context}"
        )

        self.send_text_message(prompt, display_message="Prossimo step")

    def ask_initial_prompt_with_voice(self):
        dialog = QDialog(self)
        dialog.setWindowTitle("Nuovo progetto")
        dialog.resize(820, 470)

        layout = QVBoxLayout(dialog)
        layout.setContentsMargins(18, 16, 18, 18)
        layout.setSpacing(12)

        title = QLabel("Che applicazione vuoi creare?")
        title.setObjectName("voicePromptTitle")

        subtitle = QLabel(
            "Scrivi l'idea iniziale. LocoCode la usera' per preparare l'SDD del progetto nella chat."
        )
        subtitle.setObjectName("voicePromptSubtitle")
        subtitle.setWordWrap(True)

        prompt_edit = QTextEdit()
        prompt_edit.setObjectName("voicePromptEdit")
        prompt_edit.setPlaceholderText(
            "Esempio: crea una web app per gestire ticket di assistenza, con login, dashboard, stati ticket e suggerimenti AI..."
        )

        actions = QHBoxLayout()
        cancel_button = QPushButton("Annulla")
        ok_button = QPushButton("Crea SDD")

        cancel_button.clicked.connect(dialog.reject)
        ok_button.clicked.connect(dialog.accept)

        actions.addStretch()
        actions.addWidget(cancel_button)
        actions.addWidget(ok_button)

        layout.addWidget(title)
        layout.addWidget(subtitle)
        layout.addWidget(prompt_edit, stretch=1)
        layout.addLayout(actions)

        dialog.setStyleSheet("""
            QDialog {
                background-color: #11101a;
                color: white;
            }

            #voicePromptTitle {
                color: white;
                font-size: 20px;
                font-weight: 900;
            }

            #voicePromptSubtitle {
                color: rgba(255,255,255,0.68);
                font-size: 13px;
                line-height: 1.35;
            }

            #voicePromptEdit {
                background-color: rgba(31, 31, 29, 0.97);
                color: #f7f7f2;
                border: 1px solid rgba(255,255,255,0.13);
                border-radius: 22px;
                padding: 16px;
                font-size: 15px;
            }

            QPushButton {
                background-color: rgba(255,255,255,0.10);
                color: white;
                border: 1px solid rgba(255,255,255,0.14);
                border-radius: 14px;
                padding: 10px 15px;
                font-weight: 800;
            }

            QPushButton:hover {
                background-color: rgba(255,255,255,0.18);
            }
        """)

        ok = dialog.exec() == QDialog.Accepted
        return prompt_edit.toPlainText(), ok

    def create_new_ai_project(self):
        base_folder = QFileDialog.getExistingDirectory(
            self,
            "Scegli dove creare la cartella del progetto"
        )

        if not base_folder:
            return

        project_name, ok = QInputDialog.getText(
            self,
            "Nuovo progetto",
            "Nome progetto:"
        )

        if not ok or not project_name.strip():
            return

        initial_prompt, ok = self.ask_initial_prompt_with_voice()

        if not ok:
            return

        if not initial_prompt.strip():
            QMessageBox.warning(
                self,
                "Idea mancante",
                "Scrivi cosa vuoi creare prima di avviare il nuovo progetto."
            )
            return

        try:
            project_path = self.workspace_manager.create_workspace(
                base_dir=base_folder,
                project_name=project_name,
                initial_prompt=initial_prompt,
            )

            self.current_project_path = project_path
            self.update_project_label()
            self.load_project_files(project_path)
            self.load_output_history()
            self.update_project_step_status()

            try:
                if self.file_panel.isVisible():
                    self.toggle_file_panel()
            except Exception:
                pass

            agent_index = self.agent_combo.findData("SDD Orchestrator")
            if agent_index >= 0:
                self.agent_combo.setCurrentIndex(agent_index)

            self.add_system_message(
                "Progetto creato. Ora preparo l'SDD iniziale; quando la risposta e' pronta usa Salva SDD iniziale."
            )

            initial_sdd_prompt = (
                "Sei LocoCode in modalita SDD Orchestrator.\n"
                "Devi trasformare l'idea dell'utente in un SDD iniziale completo per una web app distribuibile.\n\n"
                "Rispondi con sezioni chiare: obiettivo, requisiti funzionali, requisiti non funzionali, "
                "MVP, architettura proposta, stack, struttura cartelle, piano task numerato e prossimo passo.\n"
                "Non generare ancora tutti i file dell'app: prepara prima il progetto in modo ordinato.\n\n"
                "IDEA UTENTE:\n"
                f"{initial_prompt.strip()}"
            )

            self.send_text_message(initial_sdd_prompt, display_message=initial_prompt.strip())

        except FileExistsError as e:
            QMessageBox.warning(self, "Cartella giÃ  esistente", str(e))
        except Exception as e:
            QMessageBox.critical(
                self,
                "Errore",
                f"Errore durante la creazione del progetto AI:\n{e}"
            )

    def save_current_spec(self):
        if not self.current_project_path:
            QMessageBox.warning(
                self,
                "Nessun progetto aperto",
                "Apri o crea una cartella progetto prima di salvare la SPEC."
            )
            return

        if not self.last_ai_response.strip():
            QMessageBox.warning(
                self,
                "Nessuna SPEC disponibile",
                "Prima genera una risposta SDD con l'agente Orchestrator."
            )
            return

        try:
            self.spec_manager.create_spec_files(
                project_path=self.current_project_path,
                source_text=self.last_ai_response,
            )

            self.load_project_files(self.current_project_path)
            self.update_project_step_status()

            QMessageBox.information(
                self,
                "SPEC salvata",
                "File SPEC creati correttamente nella cartella .lc del progetto."
            )

        except Exception as e:
            QMessageBox.critical(
                self,
                "Errore",
                f"Errore durante il salvataggio della SPEC:\n{e}"
            )

    def open_project_folder(self):
        folder = QFileDialog.getExistingDirectory(self, "Apri progetto")

        if not folder:
            return

        self.current_project_path = self.resolve_project_folder(folder)
        self.update_project_label()
        self.load_project_files(self.current_project_path)
        self.load_output_history()
        self.update_project_step_status()

        try:
            if self.file_panel.isVisible():
                self.toggle_file_panel()
        except Exception:
            pass



    def repair_backend_basics(self):
        if not self.current_project_path:
            QMessageBox.warning(
                self,
                "Nessun progetto aperto",
                "Apri un progetto prima di riparare il backend."
            )
            return

        result = self.backend_guard.repair_missing_backend_basics(self.current_project_path)

        self.load_project_files(self.current_project_path)

        created = result.get("created", [])
        updated = result.get("updated", [])
        skipped = result.get("skipped", [])
        errors = result.get("errors", [])

        message = (
            f"Creati: {len(created)}\n"
            f"Aggiornati: {len(updated)}\n"
            f"GiÃ  presenti: {len(skipped)}\n"
            f"Errori: {len(errors)}"
        )

        if created:
            message += "\n\nCreati:\n" + "\n".join(created[:10])

        if updated:
            message += "\n\nAggiornati:\n" + "\n".join(updated[:10])

        if errors:
            message += "\n\nErrori:\n" + "\n".join(errors[:8])

        QMessageBox.information(
            self,
            "Backend Guard",
            message
        )


    def apply_last_ai_response_as_files(self):
        if not self.current_project_path:
            QMessageBox.warning(
                self,
                "Nessun progetto aperto",
                "Apri un progetto prima di applicare file."
            )
            return

        if not self.last_ai_response.strip():
            QMessageBox.warning(
                self,
                "Nessun output AI",
                "Non c'Ã¨ ancora una risposta AI da applicare."
            )
            return

        operations = self.builder_engine.parse_operations(self.last_ai_response)

        if not operations:
            QMessageBox.information(
                self,
                "Nessun file trovato",
                "Nell'output AI non ho trovato blocchi file applicabili."
            )
            return

        preview_lines = []

        for op in operations[:12]:
            preview_lines.append(f"- {op.get('action', 'write')}: {op.get('path')}")

        if len(operations) > 12:
            preview_lines.append(f"... altri {len(operations) - 12} file")

        confirm = QMessageBox.question(
            self,
            "Applicare file al progetto?",
            "LocoCode ha trovato questi file da creare/modificare:\\n\\n"
            + "\\n".join(preview_lines)
            + "\\n\\nVuoi applicarli alla cartella progetto?"
        )

        if confirm != QMessageBox.Yes:
            return

        result = self.builder_engine.apply_response(
            project_path=self.current_project_path,
            response_text=self.last_ai_response,
        )

        self.load_project_files(self.current_project_path)

        if hasattr(self, "backend_guard") and self.current_project_path:
            self.backend_guard.repair_missing_backend_basics(self.current_project_path)
            self.load_project_files(self.current_project_path)


        created = result.get("created", [])
        updated = result.get("updated", [])
        skipped = result.get("skipped", [])
        errors = result.get("errors", [])

        message = (
            f"Creati: {len(created)}\\n"
            f"Aggiornati: {len(updated)}\\n"
            f"Saltati: {len(skipped)}\\n"
            f"Errori: {len(errors)}"
        )

        if errors:
            message += "\\n\\nErrori:\\n" + "\\n".join(errors[:8])

        QMessageBox.information(
            self,
            "Builder Engine",
            message
        )

        self.add_system_message(
            "Modifiche applicate ai file. Ora verifica il progetto; se va bene, salva l'avanzamento e chiedi il prossimo step."
        )

        if hasattr(self, "apply_output_button"):
            self.apply_output_button.setEnabled(False)


    def load_project_files(self, folder):
        self.file_list.clear()

        priority_files = [
            ".lc/spec/sdd.md",
            ".lc/spec/requirements.md",
            ".lc/spec/architecture.md",
            ".lc/spec/tasks.md",
            ".lc/memory/project_context.md",
            ".lc/logs/last_output.txt",
        ]

        added = set()

        for relative_path in priority_files:
            full_path = Path(folder) / relative_path
            if full_path.exists():
                self.file_list.addItem(relative_path)
                added.add(relative_path)

        allowed_extensions = [
            ".py",
            ".js",
            ".jsx",
            ".ts",
            ".tsx",
            ".html",
            ".css",
            ".json",
            ".md",
            ".txt",
            ".php",
            ".dart",
            ".java",
            ".cpp",
            ".c",
            ".cs",
            ".xml",
            ".yaml",
            ".yml",
            ".env",
            ".toml",
        ]

        ignored_dirs = [
            ".git",
            "__pycache__",
            "node_modules",
            ".venv",
            "venv",
            "dist",
            "build",
            ".next",
        ]

        for root, dirs, files in os.walk(folder):
            dirs[:] = [d for d in dirs if d not in ignored_dirs]

            for file in files:
                ext = os.path.splitext(file)[1].lower()

                if ext in allowed_extensions or file in [".env", ".env.example"]:
                    full_path = os.path.join(root, file)
                    relative_path = os.path.relpath(full_path, folder)
                    relative_path = relative_path.replace("\\", "/")
                    if relative_path in added:
                        continue
                    self.file_list.addItem(relative_path)
                    added.add(relative_path)


# === LOCOCODE_PROJECT_RESUME_ENGINE_BEGIN ===
# Motore resume progetto: carica stato, SPEC, memoria e ultimo output quando riapri un progetto.
import json as _lc_json
import re as _lc_re
from pathlib import Path as _LcPath


def _lc_read_text(path, limit=None):
    try:
        text = _LcPath(path).read_text(encoding="utf-8", errors="ignore")
        if limit and len(text) > limit:
            return text[:limit] + "\n\n...[contenuto tagliato]..."
        return text
    except Exception:
        return ""


def _lc_file_exists(path):
    try:
        return _LcPath(path).exists()
    except Exception:
        return False


def _lc_find_first_unchecked_task_line(text):
    if not text:
        return ""

    for line in text.splitlines():
        stripped = line.strip()

        # Markdown task classico: - [ ] Titolo
        m = _lc_re.match(r"^[-*]\s+\[\s\]\s+(.+)$", stripped)
        if m:
            return m.group(1).strip()

        # Variante numerata: 1. [ ] Titolo
        m = _lc_re.match(r"^\d+[\.)]\s+\[\s\]\s+(.+)$", stripped)
        if m:
            return m.group(1).strip()

    return ""


def _lc_analyze_task_progress(text):
    progress = {
        "total": 0,
        "completed": 0,
        "next_number": 0,
        "next_title": "",
        "last_completed_number": 0,
        "last_completed_title": "",
    }

    if not text:
        return progress

    task_number = 0

    for line in text.splitlines():
        stripped = line.strip()
        match = _lc_re.match(r"^(?:[-*]|\d+[\.)])\s+\[([ xX])\]\s+(.+)$", stripped)

        if not match:
            continue

        task_number += 1
        progress["total"] = task_number
        checked = match.group(1).lower() == "x"
        title = match.group(2).strip()

        if checked:
            progress["completed"] += 1
            progress["last_completed_number"] = task_number
            progress["last_completed_title"] = title
        elif not progress["next_number"]:
            progress["next_number"] = task_number
            progress["next_title"] = title

    return progress


def _lc_format_task_progress_label(progress, fallback):
    total = int(progress.get("total") or 0)
    completed = int(progress.get("completed") or 0)
    next_number = int(progress.get("next_number") or 0)

    if total <= 0:
        return fallback

    if next_number:
        if completed:
            return f"Task {completed}/{total} completato · prossimo {next_number}"
        return f"Task 0/{total} completati · prossimo 1"

    return f"Task {total}/{total} completati · verifica finale"


def _lc_detect_project_state(root):
    root = _LcPath(root)
    lc = root / ".lc"

    req = lc / "spec" / "requirements.md"
    arch = lc / "spec" / "architecture.md"
    tasks = lc / "spec" / "tasks.md"
    memory = lc / "memory" / "project_context.md"
    last_output = lc / "logs" / "last_output.txt"

    state = {
        "status": "Fase: Specifica",
        "phase": "specifica",
        "next_task": "",
        "has_lc": lc.exists(),
        "has_requirements": req.exists(),
        "has_architecture": arch.exists(),
        "has_tasks": tasks.exists(),
        "has_memory": memory.exists(),
        "has_last_output": last_output.exists(),
    }

    # Se c'Ã¨ un output AI ma non Ã¨ ancora stato salvato come SPEC.
    if last_output.exists() and not req.exists():
        state["status"] = "Da salvare"
        state["phase"] = "da_salvare"
        return state

    if req.exists() and not arch.exists():
        state["status"] = "Fase: Architettura"
        state["phase"] = "architettura"
        return state

    if arch.exists() and not tasks.exists():
        state["status"] = "Fase: Piano"
        state["phase"] = "piano"
        return state

    if tasks.exists():
        task_text = _lc_read_text(tasks)
        next_task = _lc_find_first_unchecked_task_line(task_text)
        progress = _lc_analyze_task_progress(task_text)
        state["task_progress"] = progress

        if next_task:
            state["next_task"] = next_task
            state["status"] = _lc_format_task_progress_label(progress, "Fase: Sviluppo")
            state["phase"] = "sviluppo"
            return state

        if task_text.strip():
            state["status"] = _lc_format_task_progress_label(progress, "Fase: Sviluppo")
            state["phase"] = "sviluppo"
            return state

    if req.exists():
        state["status"] = "Fase: Specifica"
        state["phase"] = "specifica_pronta"
        return state

    return state


def _lc_collect_resume_context(root):
    root = _LcPath(root)
    lc = root / ".lc"

    paths = [
        lc / "memory" / "project_context.md",
        lc / "spec" / "requirements.md",
        lc / "spec" / "architecture.md",
        lc / "spec" / "tasks.md",
        lc / "logs" / "last_output.txt",
    ]

    chunks = []

    for path in paths:
        if path.exists():
            content = _lc_read_text(path, 16000)
            try:
                rel = path.relative_to(root)
            except Exception:
                rel = path
            chunks.append(f"\n\n# FILE: {rel}\n{content}")

    # Piccolo albero progetto, utile per riprendere senza perdere contesto.
    tree_lines = []
    ignored_dirs = {".git", "node_modules", "venv", ".venv", "__pycache__", "dist", "build", ".next"}

    try:
        for current, dirs, files in os.walk(root):
            current_path = _LcPath(current)
            dirs[:] = [d for d in dirs if d not in ignored_dirs]

            rel_dir = current_path.relative_to(root)
            depth = 0 if str(rel_dir) == "." else len(rel_dir.parts)

            if depth > 3:
                dirs[:] = []
                continue

            for file in files[:40]:
                rel_file = current_path / file
                try:
                    tree_lines.append(str(rel_file.relative_to(root)))
                except Exception:
                    pass

            if len(tree_lines) > 250:
                break
    except Exception:
        pass

    if tree_lines:
        chunks.append("\n\n# ALBERO PROGETTO\n" + "\n".join(tree_lines[:250]))

    return "".join(chunks).strip()


def _lc_save_last_output(window, response):
    if not getattr(window, "current_project_path", None):
        return

    if not response:
        return

    root = _LcPath(window.current_project_path)
    logs = root / ".lc" / "logs"
    logs.mkdir(parents=True, exist_ok=True)

    try:
        (logs / "last_output.txt").write_text(response, encoding="utf-8")
    except Exception:
        pass


def _lc_load_last_output(window):
    if not getattr(window, "current_project_path", None):
        return

    root = _LcPath(window.current_project_path)
    last_output = root / ".lc" / "logs" / "last_output.txt"

    if not last_output.exists():
        return

    content = _lc_read_text(last_output)

    if not content.strip():
        return

    try:
        window.last_ai_response = content
    except Exception:
        pass

    try:
        if hasattr(window, "save_spec_button"):
            window.save_spec_button.setEnabled(True)
    except Exception:
        pass

    # Non caricare l'SDD/ultimo output nella chat quando si apre un progetto:
    # resta disponibile nei file progetto e nella finestra SDD dedicata.


def _lc_resume_after_project_open(window):
    if not getattr(window, "current_project_path", None):
        return

    _lc_load_last_output(window)

    try:
        window.update_project_step_status()
    except Exception:
        pass

    try:
        if hasattr(window, "load_project_files"):
            window.load_project_files(window.current_project_path)
    except Exception:
        pass


def _lc_detect_next_step(self, root):
    state = _lc_detect_project_state(root)
    return state.get("status", "Fase: Specifica")


def _lc_update_project_step_status(self):
    root = None

    try:
        root = self.get_project_root()
    except Exception:
        if getattr(self, "current_project_path", None):
            root = _LcPath(self.current_project_path)

    if not root:
        try:
            self.step_label.setText("Fase progetto: -")
        except Exception:
            pass
        return

    state = _lc_detect_project_state(root)

    try:
        phase = state.get("phase", "-")
        next_task = (state.get("next_task") or "").strip()
        phase_labels = {
            "specifica": "Fase: Specifica",
            "specifica_pronta": "Fase: Specifica pronta",
            "da_salvare": "Prossimo step: Salva progetto",
            "architettura": "Fase: Architettura",
            "piano": "Fase: Piano operativo",
            "sviluppo": "Fase: Sviluppo",
        }

        status = state.get("status", "")

        if not status:
            if next_task:
                status = f"Prossimo step: {next_task}"
            else:
                status = phase_labels.get(phase, "Fase: Specifica")

        self.step_label.setText(status)
        self.step_label.setToolTip(
            "Fase progetto: "
            + phase
            + (f"\nProssimo step: {next_task}" if next_task else "")
        )
    except Exception:
        pass


def _lc_collect_project_context_for_next_step(self, root):
    return _lc_collect_resume_context(root)


def _lc_run_next_step(self):
    root = None

    try:
        root = self.get_project_root()
    except Exception:
        if getattr(self, "current_project_path", None):
            root = _LcPath(self.current_project_path)

    if not root:
        try:
            QMessageBox.warning(self, "Nessun progetto", "Apri un progetto prima di continuare.")
        except Exception:
            pass
        return

    state = _lc_detect_project_state(root)
    context = _lc_collect_resume_context(root)

    if not context:
        try:
            QMessageBox.warning(
                self,
                "Contesto progetto non trovato",
                "Non trovo ancora SPEC, memoria o ultimo output nella cartella .lc.\n"
                "Scrivi l'idea del progetto e genera la prima specifica."
            )
        except Exception:
            pass
        return

    try:
        agent_index = self.agent_combo.findData("SDD Orchestrator")
        if agent_index >= 0:
            self.agent_combo.setCurrentIndex(agent_index)
    except Exception:
        pass

    prompt = (
        "Sei LocoCode in modalitÃ  SDD Orchestrator.\n"
        "Devi RIPRENDERE un progetto giÃ  aperto, non ricominciare da zero.\n\n"
        f"STATO RILEVATO: {state.get('status')}\n"
        f"FASE: {state.get('phase')}\n"
        f"PROSSIMO TASK RILEVATO: {state.get('next_task') or 'non specificato'}\n\n"
        "Regole:\n"
        "- Se esistono file .lc/spec, usali come fonte principale.\n"
        "- Se esiste .lc/logs/last_output.txt e la SPEC non Ã¨ salvata, spiega che va salvata/applicata.\n"
        "- Non chiedere di rigenerare la SPEC se requirements/architecture/tasks esistono giÃ .\n"
        "- Continua dal punto piÃ¹ avanzato disponibile.\n"
        "- Se devi proporre modifiche ai file, indica chiaramente i file da creare/modificare.\n\n"
        "CONTESTO PROGETTO:\n"
        f"{context}"
    )

    try:
        self.send_text_message(prompt, display_message="Prossimo step")
    except Exception as e:
        try:
            QMessageBox.critical(self, "Errore", f"Errore durante Continua sviluppo:\n{e}")
        except Exception:
            pass


def _lc_wrap_open_project_folder(original):
    def wrapped(self, *args, **kwargs):
        result = original(self, *args, **kwargs)
        _lc_resume_after_project_open(self)
        return result
    return wrapped


def _lc_wrap_create_new_ai_project(original):
    def wrapped(self, *args, **kwargs):
        result = original(self, *args, **kwargs)
        _lc_resume_after_project_open(self)
        return result
    return wrapped


def _lc_wrap_on_ai_finished(original):
    def wrapped(self, response, *args, **kwargs):
        result = original(self, response, *args, **kwargs)
        try:
            _lc_save_last_output(self, response or "")
            self.update_project_step_status()
        except Exception:
            pass
        return result
    return wrapped


try:
    MainWindow.detect_next_step = _lc_detect_next_step
    MainWindow.update_project_step_status = _lc_update_project_step_status
    MainWindow.collect_project_context_for_next_step = _lc_collect_project_context_for_next_step
    MainWindow.run_next_step = _lc_run_next_step

    if not getattr(MainWindow, "_lc_resume_open_wrapped", False):
        MainWindow.open_project_folder = _lc_wrap_open_project_folder(MainWindow.open_project_folder)
        MainWindow._lc_resume_open_wrapped = True

    if hasattr(MainWindow, "create_new_ai_project") and not getattr(MainWindow, "_lc_resume_create_wrapped", False):
        MainWindow.create_new_ai_project = _lc_wrap_create_new_ai_project(MainWindow.create_new_ai_project)
        MainWindow._lc_resume_create_wrapped = True

    if hasattr(MainWindow, "on_ai_finished") and not getattr(MainWindow, "_lc_resume_finished_wrapped", False):
        MainWindow.on_ai_finished = _lc_wrap_on_ai_finished(MainWindow.on_ai_finished)
        MainWindow._lc_resume_finished_wrapped = True

except Exception:
    pass
# === LOCOCODE_PROJECT_RESUME_ENGINE_END ===


# === LOCOCODE_PROJECT_STATE_ENGINE_BEGIN ===
# Motore salvataggio progetto: rende "Salva progetto" piÃ¹ robusto.
import json as _lc_state_json
import re as _lc_state_re
from datetime import datetime as _lc_state_datetime
from pathlib import Path as _LcStatePath


def _lc_state_get_project_root(window):
    if getattr(window, "current_project_path", None):
        return _LcStatePath(window.current_project_path)

    try:
        return _LcStatePath(window.get_project_root())
    except Exception:
        return None


def _lc_state_safe_read(path):
    try:
        return _LcStatePath(path).read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""


def _lc_state_safe_write(path, content):
    path = _LcStatePath(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content or "", encoding="utf-8")


def _lc_state_extract_visible_output(window):
    # 1. Prima usa last_ai_response, che dovrebbe essere la fonte corretta.
    try:
        value = getattr(window, "last_ai_response", "")
        if value and str(value).strip():
            return str(value)
    except Exception:
        pass

    # 2. Poi prova output_text.
    try:
        output_text = getattr(window, "output_text", None)
        if output_text is not None:
            if hasattr(output_text, "toPlainText"):
                value = output_text.toPlainText()
            elif hasattr(output_text, "toHtml"):
                value = output_text.toHtml()
            else:
                value = ""
            if value and str(value).strip():
                return str(value)
    except Exception:
        pass

    # 3. Poi prova chat_area.
    try:
        chat_area = getattr(window, "chat_area", None)
        if chat_area is not None:
            if hasattr(chat_area, "toPlainText"):
                value = chat_area.toPlainText()
            elif hasattr(chat_area, "toHtml"):
                value = chat_area.toHtml()
            else:
                value = ""
            if value and str(value).strip():
                return str(value)
    except Exception:
        pass

    return ""


def _lc_state_section(text, names):
    if not text:
        return ""

    # Cerca sezioni Markdown tipo:
    # ## Requirements
    # ## Requisiti
    # ## Architecture
    # ## Tasks
    names_pattern = "|".join([_lc_state_re.escape(name) for name in names])

    pattern = (
        r"(?ims)^#{1,4}\s*(?:"
        + names_pattern
        + r")\s*:?\s*$"
        + r"(.*?)"
        + r"(?=^#{1,4}\s+\S|\Z)"
    )

    m = _lc_state_re.search(pattern, text)
    if m:
        return m.group(1).strip()

    # Fallback con titoli in grassetto.
    pattern = (
        r"(?ims)^\s*\*\*(?:"
        + names_pattern
        + r")\*\*\s*:?\s*$"
        + r"(.*?)"
        + r"(?=^\s*\*\*\S.*?\*\*|\Z)"
    )

    m = _lc_state_re.search(pattern, text)
    if m:
        return m.group(1).strip()

    return ""


def _lc_state_build_requirements(text):
    req = _lc_state_section(
        text,
        [
            "SPEC",
            "Spec",
            "Specifiche",
            "Specifica",
            "Requisiti",
            "Requirements",
            "MVP",
            "Obiettivi",
            "FunzionalitÃ ",
            "Funzionalita",
        ],
    )

    if req:
        return "# Requisiti progetto\n\n" + req.strip() + "\n"

    # Se non riesce a separare, salva almeno un riassunto grezzo.
    return "# Requisiti progetto\n\n" + text.strip() + "\n"


def _lc_state_build_architecture(text):
    arch = _lc_state_section(
        text,
        [
            "Architettura",
            "Architecture",
            "Stack",
            "Backend",
            "Frontend",
            "Database",
            "Struttura tecnica",
        ],
    )

    if arch:
        return "# Architettura progetto\n\n" + arch.strip() + "\n"

    return ""


def _lc_state_build_tasks(text):
    tasks = _lc_state_section(
        text,
        [
            "Task",
            "Tasks",
            "Piano",
            "Roadmap",
            "Step",
            "Passi",
            "AttivitÃ ",
            "Attivita",
        ],
    )

    if tasks:
        return "# Task progetto\n\n" + tasks.strip() + "\n"

    # Fallback: se nel testo ci sono liste operative, trasformale in tasks.
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if _lc_state_re.match(r"^[-*]\s+", stripped) or _lc_state_re.match(r"^\d+[\.)]\s+", stripped):
            clean = _lc_state_re.sub(r"^[-*]\s+", "", stripped)
            clean = _lc_state_re.sub(r"^\d+[\.)]\s+", "", clean)
            if clean and len(clean) < 180:
                lines.append(f"- [ ] {clean}")

    if lines:
        return "# Task progetto\n\n" + "\n".join(lines[:40]) + "\n"

    return ""


def _lc_state_is_sdd_response(text):
    content = text or ""

    if len(content) > 3000:
        return True

    markers = [
        "SDD",
        "Requisiti",
        "Requirements",
        "Architettura",
        "Architecture",
        "Tasks",
        "Task progetto",
        "Piano operativo",
        "MVP",
    ]

    return sum(1 for marker in markers if marker.lower() in content.lower()) >= 3


def _lc_state_detect_phase(root):
    root = _LcStatePath(root)
    lc = root / ".lc"

    req = lc / "spec" / "requirements.md"
    arch = lc / "spec" / "architecture.md"
    tasks = lc / "spec" / "tasks.md"

    if tasks.exists() and _lc_state_safe_read(tasks).strip():
        return "sviluppo", "Fase: Sviluppo"

    if arch.exists() and _lc_state_safe_read(arch).strip():
        return "piano", "Fase: Piano"

    if req.exists() and _lc_state_safe_read(req).strip():
        return "architettura", "Fase: Architettura"

    return "specifica", "Fase: Specifica"


def _lc_state_save_project(window):
    root = _lc_state_get_project_root(window)

    if not root:
        try:
            QMessageBox.warning(window, "Nessun progetto", "Apri o crea un progetto prima di salvare.")
        except Exception:
            pass
        return

    output = _lc_state_extract_visible_output(window)

    if not output.strip():
        try:
            QMessageBox.warning(
                window,
                "Nessuna risposta da salvare",
                "Non trovo ancora una risposta AI da salvare nel progetto."
            )
        except Exception:
            pass
        return

    lc = root / ".lc"
    memory_dir = lc / "memory"
    spec_dir = lc / "spec"
    logs_dir = lc / "logs"

    memory_dir.mkdir(parents=True, exist_ok=True)
    spec_dir.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)

    # Salva sempre ultimo output.
    _lc_state_safe_write(logs_dir / "last_output.txt", output)

    # Salva memoria aggiornata appendendo timestamp.
    now = _lc_state_datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    memory_path = memory_dir / "project_context.md"
    old_memory = _lc_state_safe_read(memory_path)

    memory_entry = (
        f"\n\n---\n\n"
        f"## Aggiornamento {now}\n\n"
        f"{output.strip()}\n"
    )

    if old_memory.strip():
        _lc_state_safe_write(memory_path, old_memory.rstrip() + memory_entry)
    else:
        _lc_state_safe_write(
            memory_path,
            "# Contesto progetto\n\n"
            + f"Creato/aggiornato: {now}\n\n"
            + output.strip()
            + "\n",
        )

    is_sdd = _lc_state_is_sdd_response(output)

    if is_sdd:
        # SPEC / Architettura / Task: scrive solo quando la risposta e' davvero un SDD.
        requirements = _lc_state_build_requirements(output)
        architecture = _lc_state_build_architecture(output)
        tasks = _lc_state_build_tasks(output)

        if requirements.strip():
            _lc_state_safe_write(spec_dir / "requirements.md", requirements)

        if architecture.strip():
            _lc_state_safe_write(spec_dir / "architecture.md", architecture)

        if tasks.strip():
            _lc_state_safe_write(spec_dir / "tasks.md", tasks)

        _lc_state_safe_write(
            spec_dir / "sdd.md",
            "# SDD progetto\n\n"
            + f"Aggiornato: {now}\n\n"
            + "## Documento completo\n\n"
            + output.strip()
            + "\n",
        )

    phase, label = _lc_state_detect_phase(root)

    state = {
        "updated_at": now,
        "phase": phase,
        "label": label,
        "has_requirements": (spec_dir / "requirements.md").exists(),
        "has_architecture": (spec_dir / "architecture.md").exists(),
        "has_tasks": (spec_dir / "tasks.md").exists(),
        "has_last_output": (logs_dir / "last_output.txt").exists(),
    }

    _lc_state_safe_write(lc / "state.json", _lc_state_json.dumps(state, ensure_ascii=False, indent=2))

    try:
        if hasattr(window, "update_project_step_status"):
            window.update_project_step_status()
        else:
            window.step_label.setText(label)
            window.step_label.setToolTip("Stato progetto salvato: " + phase)
    except Exception:
        pass

    try:
        if hasattr(window, "add_system_message"):
            window.add_system_message(
                "Avanzamento salvato in .lc. Puoi continuare con Prossimo step quando sei pronto."
            )
    except Exception:
        pass

    try:
        QMessageBox.information(
            window,
            "Progetto salvato",
            "Stato progetto salvato correttamente nella cartella .lc."
        )
    except Exception:
        pass


try:
    MainWindow.save_current_spec = _lc_state_save_project
except Exception:
    pass
# === LOCOCODE_PROJECT_STATE_ENGINE_END ===


