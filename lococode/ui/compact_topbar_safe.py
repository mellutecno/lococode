from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QDialog,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QPushButton,
    QMenu,
    QTextEdit,
    QSplitter,
)


def _disconnect_clicked(button):
    if button is None:
        return

    try:
        button.clicked.disconnect()
    except Exception:
        pass


def _hide(widget):
    if widget is None:
        return

    try:
        widget.hide()
        widget.setVisible(False)
        widget.setMaximumWidth(0)
        widget.setMinimumWidth(0)
    except Exception:
        pass


def _compact_label(widget, width):
    if widget is None:
        return

    try:
        widget.setMaximumWidth(width)
        widget.setToolTip(widget.text())
    except Exception:
        pass


def _clear_layout(layout, keep_widgets=None):
    keep_widgets = set(keep_widgets or [])

    if layout is None:
        return

    while layout.count():
        item = layout.takeAt(0)

        child_layout = item.layout()
        widget = item.widget()

        if child_layout is not None:
            _clear_layout(child_layout, keep_widgets)

        if widget is not None:
            if widget in keep_widgets:
                widget.setParent(None)
            else:
                try:
                    widget.hide()
                    widget.setParent(None)
                    widget.deleteLater()
                except Exception:
                    pass


def _add_action(menu, title, callback, enabled=True):
    action = menu.addAction(title)
    action.setEnabled(enabled)

    if callback is not None:
        action.triggered.connect(callback)

    return action


def _make_project_menu(window):
    menu = QMenu(window)

    if hasattr(window, "open_project_folder"):
        _add_action(menu, "Apri progetto esistente", window.open_project_folder)

    if hasattr(window, "create_new_ai_project"):
        _add_action(menu, "Nuovo progetto", window.create_new_ai_project)

    return menu


def _make_actions_menu(window):
    menu = QMenu(window)

    if hasattr(window, "save_current_spec"):
        _add_action(menu, "1. Salva SDD iniziale", window.save_current_spec)

    if hasattr(window, "run_next_step"):
        _add_action(menu, "2. Prepara prossimo step", window.run_next_step)

    menu.addSeparator()

    if hasattr(window, "apply_last_ai_response_as_files"):
        action_apply = _add_action(
            menu,
            "Dopo uno step: applica modifiche",
            window.apply_last_ai_response_as_files,
            enabled=True,
        )
        window.action_apply_output = action_apply

    if hasattr(window, "repair_backend_basics"):
        _add_action(menu, "Poi verifica progetto", window.repair_backend_basics)

    if hasattr(window, "save_current_spec"):
        _add_action(menu, "Poi salva avanzamento", window.save_current_spec)

    return menu


def _make_left_command_menu(window):
    menu = QMenu(window)

    project_menu = menu.addMenu("Progetto")

    if hasattr(window, "open_project_folder"):
        _add_action(project_menu, "Apri progetto esistente", window.open_project_folder)

    if hasattr(window, "create_new_ai_project"):
        _add_action(project_menu, "Nuovo progetto", window.create_new_ai_project)

    actions_menu = menu.addMenu("Procedura")

    if hasattr(window, "save_current_spec"):
        _add_action(actions_menu, "1. Salva SDD iniziale", window.save_current_spec)

    if hasattr(window, "run_next_step"):
        _add_action(actions_menu, "2. Prepara prossimo step", window.run_next_step)

    actions_menu.addSeparator()

    if hasattr(window, "apply_last_ai_response_as_files"):
        action_apply = _add_action(
            actions_menu,
            "Dopo uno step: applica modifiche",
            window.apply_last_ai_response_as_files,
            enabled=True,
        )
        window.action_apply_output = action_apply

    if hasattr(window, "repair_backend_basics"):
        _add_action(actions_menu, "Poi verifica progetto", window.repair_backend_basics)

    if hasattr(window, "save_current_spec"):
        _add_action(actions_menu, "Poi salva avanzamento", window.save_current_spec)

    if hasattr(window, "toggle_file_panel"):
        files_menu = menu.addMenu("File progetto")
        _add_action(files_menu, "Cartella progetto", window.toggle_file_panel)
        if hasattr(window, "open_sdd_project_file"):
            _add_action(files_menu, "SDD progetto", window.open_sdd_project_file)

    return menu


def _style_global(window):
    css = """
        #topDropdownMenuButton {
            background-color: rgba(8, 12, 24, 0.72);
            color: white;
            border: 1px solid rgba(255,255,255,0.18);
            border-radius: 14px;
            padding: 8px 14px;
            min-width: 108px;
            max-width: 118px;
            font-weight: 900;
        }

        #topDropdownMenuButton:hover {
            background-color: rgba(255,255,255,0.22);
        }

        #topDropdownMenuButton::menu-indicator {
            image: none;
            width: 0px;
        }

        #leftCommandMenuButton {
            background-color: rgba(8, 12, 24, 0.72);
            color: white;
            border: 1px solid rgba(255,255,255,0.18);
            border-radius: 17px;
            padding: 10px 18px;
            min-height: 26px;
            max-height: 46px;
            font-size: 17px;
            font-weight: 900;
            text-align: center;
        }

        #leftCommandMenuButton:hover {
            background-color: rgba(255,255,255,0.18);
        }

        #leftCommandMenuButton::menu-indicator {
            image: none;
            width: 0px;
        }

        QMenu {
            background-color: rgba(10, 15, 31, 0.98);
            color: white;
            border: 1px solid rgba(255,255,255,0.16);
            border-radius: 12px;
            padding: 7px;
        }

        QMenu::item {
            padding: 10px 34px 10px 15px;
            border-radius: 9px;
            min-width: 150px;
        }

        QMenu::item:selected {
            background-color: rgba(37, 99, 235, 0.72);
        }

        QMenu::separator {
            height: 1px;
            background: rgba(255,255,255,0.14);
            margin: 6px 8px;
        }
    """

    try:
        current = window.styleSheet() or ""
        if "#topDropdownMenuButton" not in current:
            window.setStyleSheet(current + css)
    except Exception:
        pass


def _button_style(button):
    if button is None:
        return

    try:
        button.setMinimumSize(34, 34)
        button.setMaximumSize(34, 34)
        button.setStyleSheet("""
            QPushButton {
                background-color: rgba(255,255,255,0.07);
                color: white;
                border: 1px solid rgba(255,255,255,0.13);
                border-radius: 17px;
                padding: 0px;
                font-size: 16px;
                font-weight: 900;
            }

            QPushButton:hover {
                background-color: rgba(255,255,255,0.18);
            }
        """)
    except Exception:
        pass


def open_file_project_big(window):
    dialog = QDialog(window)
    dialog.setWindowTitle("File progetto")
    dialog.setObjectName("fileProjectBigDialog")
    dialog.resize(900, 660)
    dialog.setWindowFlag(Qt.WindowMaximizeButtonHint, True)
    dialog.setWindowFlag(Qt.WindowMinimizeButtonHint, True)

    try:
        geo = window.geometry()
        width = max(820, int(geo.width() * 0.70))
        height = max(560, int(geo.height() * 0.72))
        x = geo.x() + int((geo.width() - width) / 2)
        y = geo.y() + 70
        dialog.setGeometry(x, y, width, height)
    except Exception:
        pass

    dialog.setStyleSheet("""
        #fileProjectBigDialog {
            background-color: #090b18;
        }

        QLabel {
            color: white;
            font-size: 22px;
            font-weight: 900;
            border: none;
            background: transparent;
        }

        QPushButton {
            background-color: rgba(255,255,255,0.10);
            color: white;
            border: 1px solid rgba(255,255,255,0.14);
            border-radius: 13px;
            padding: 8px 13px;
            font-weight: 800;
        }

        QListWidget {
            background-color: rgba(8, 13, 31, 0.94);
            color: #dbeafe;
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 18px;
            padding: 12px;
            font-size: 15px;
        }

        QListWidget::item {
            padding: 7px;
            border-radius: 8px;
        }

        QListWidget::item:selected {
            background-color: #2563eb;
            color: white;
        }
    """)

    layout = QVBoxLayout(dialog)
    layout.setContentsMargins(18, 16, 18, 18)
    layout.setSpacing(12)

    header = QHBoxLayout()
    title = QLabel("File progetto")
    refresh_button = QPushButton("Aggiorna")
    close_button = QPushButton("Chiudi")

    header.addWidget(title)
    header.addStretch()
    header.addWidget(refresh_button)
    header.addWidget(close_button)

    file_list_big = QListWidget()

    def reload_files():
        file_list_big.clear()

        source = getattr(window, "file_list", None)

        if source is not None:
            try:
                for i in range(source.count()):
                    item = source.item(i)
                    if item is not None:
                        file_list_big.addItem(item.text())
            except Exception:
                pass

        if file_list_big.count() == 0:
            file_list_big.addItem("Nessun file caricato. Apri prima una cartella progetto.")

    refresh_button.clicked.connect(reload_files)
    close_button.clicked.connect(dialog.close)

    layout.addLayout(header)
    layout.addWidget(file_list_big, stretch=1)

    reload_files()
    dialog.setWindowState(dialog.windowState() | Qt.WindowMaximized)
    dialog.exec()


def _populate_file_list_from_window(window, target_list):
    target_list.clear()

    source = getattr(window, "file_list", None)

    if source is not None:
        try:
            for i in range(source.count()):
                item = source.item(i)
                if item is not None:
                    target_list.addItem(item.text())
        except Exception:
            pass

    if target_list.count() == 0:
        target_list.addItem("Nessun file caricato. Apri prima una cartella progetto.")


def _lc_file_display_name(relative_path):
    normalized = str(relative_path).replace("\\", "/")
    names = {
        ".lc/spec/sdd.md": "SDD progetto",
        ".lc/spec/requirements.md": "Requisiti progetto",
        ".lc/spec/architecture.md": "Architettura progetto",
        ".lc/spec/tasks.md": "Task progetto",
        ".lc/memory/project_context.md": "Memoria progetto",
        ".lc/logs/last_output.txt": "Ultimo output AI",
    }
    return names.get(normalized, normalized)


def _lc_resolve_project_file(window, relative_path):
    root = getattr(window, "current_project_path", None)
    if not root:
        return None
    return __import__("pathlib").Path(root) / str(relative_path).replace("/", "\\")


def _lc_preview_project_file(window, relative_path, preview):
    path = _lc_resolve_project_file(window, relative_path)

    if path is None or not path.exists() or not path.is_file():
        preview.setPlainText("Seleziona un file del progetto.")
        return

    if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}:
        preview.setPlainText(f"Anteprima immagine non ancora integrata qui.\n\nFile:\n{path}")
        return

    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except Exception as exc:
        text = f"Impossibile leggere il file:\n{exc}"

    preview.setPlainText(text)


def _lc_populate_project_file_browser(window, target_list, include_internal=False):
    target_list.clear()
    source = getattr(window, "file_list", None)

    if source is not None:
        try:
            for i in range(source.count()):
                item = source.item(i)
                if item is None:
                    continue
                rel = item.text()
                normalized = str(rel).replace("\\", "/")

                if not include_internal and normalized.startswith(".lc/"):
                    continue

                display = _lc_file_display_name(rel)
                target_list.addItem(display)
                target_list.item(target_list.count() - 1).setData(Qt.UserRole, rel)
        except Exception:
            pass

    if target_list.count() == 0:
        target_list.addItem("Nessun file progetto trovato.")


def _lc_select_project_file(target_list, relative_path):
    wanted = str(relative_path).replace("\\", "/")

    for i in range(target_list.count()):
        item = target_list.item(i)
        if item is not None and str(item.data(Qt.UserRole)).replace("\\", "/") == wanted:
            target_list.setCurrentRow(i)
            return True

    if target_list.count() > 0:
        target_list.setCurrentRow(0)

    return False


def open_file_project_floating(window, focus_file=None, include_internal=False):
    existing = getattr(window, "file_project_floating_dialog", None)

    try:
        if existing is not None and existing.isVisible():
            _lc_populate_project_file_browser(window, existing.file_list_widget, include_internal=include_internal)
            if focus_file:
                _lc_select_project_file(existing.file_list_widget, focus_file)
            existing.raise_()
            existing.activateWindow()
            return existing
    except Exception:
        pass

    dialog = QDialog(window)
    dialog.setWindowTitle("File progetto")
    dialog.setObjectName("fileProjectFloatingDialog")
    dialog.setWindowFlag(Qt.Window, True)
    dialog.setWindowFlag(Qt.WindowMinMaxButtonsHint, True)
    dialog.setMinimumSize(720, 460)
    dialog.resize(920, 620)

    try:
        geo = window.geometry()
        dialog.move(geo.x() + 26, geo.y() + 170)
    except Exception:
        pass

    dialog.setStyleSheet("""
        #fileProjectFloatingDialog {
            background-color: #11101a;
        }

        QLabel {
            color: white;
            background: transparent;
            border: none;
            font-size: 18px;
            font-weight: 900;
        }

        QPushButton {
            background-color: rgba(255,255,255,0.08);
            color: white;
            border: 1px solid rgba(255,255,255,0.13);
            border-radius: 12px;
            padding: 8px 12px;
            font-weight: 800;
        }

        QPushButton:hover {
            background-color: rgba(255,255,255,0.16);
        }

        QListWidget, QTextEdit {
            background-color: rgba(7, 10, 22, 0.96);
            color: #e7eeff;
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 16px;
            padding: 10px;
            font-size: 14px;
        }

        QTextEdit {
            font-family: Consolas, "Segoe UI", monospace;
            line-height: 1.35;
        }

        QListWidget::item {
            padding: 7px;
            border-radius: 8px;
        }

        QListWidget::item:selected {
            background-color: rgba(37, 99, 235, 0.78);
            color: white;
        }
    """)

    layout = QVBoxLayout(dialog)
    layout.setContentsMargins(14, 14, 14, 14)
    layout.setSpacing(12)

    header = QHBoxLayout()
    title = QLabel("Cartella progetto")
    refresh_button = QPushButton("Aggiorna")
    close_button = QPushButton("Chiudi")

    header.addWidget(title)
    header.addStretch()
    header.addWidget(refresh_button)
    header.addWidget(close_button)

    file_list = QListWidget()
    dialog.file_list_widget = file_list
    preview = QTextEdit()
    preview.setReadOnly(True)
    preview.setPlaceholderText("Seleziona un file per leggerlo qui.")

    splitter = QSplitter(Qt.Horizontal)
    splitter.addWidget(file_list)
    splitter.addWidget(preview)
    splitter.setSizes([280, 620])

    refresh_button.clicked.connect(lambda: _lc_populate_project_file_browser(window, file_list, include_internal=include_internal))
    close_button.clicked.connect(dialog.close)
    dialog.destroyed.connect(lambda *_: setattr(window, "file_project_floating_dialog", None))
    file_list.currentItemChanged.connect(
        lambda current, previous: _lc_preview_project_file(
            window,
            current.data(Qt.UserRole) if current is not None else "",
            preview,
        )
    )

    layout.addLayout(header)
    layout.addWidget(splitter, stretch=1)

    _lc_populate_project_file_browser(window, file_list, include_internal=include_internal)
    if focus_file:
        _lc_select_project_file(file_list, focus_file)
    elif file_list.count() > 0:
        file_list.setCurrentRow(0)

    try:
        panel = getattr(window, "file_panel", None)
        if panel is not None:
            panel.setVisible(False)
    except Exception:
        pass

    window.file_project_floating_dialog = dialog
    dialog.show()
    dialog.raise_()
    dialog.activateWindow()
    return dialog


def _close_file_panel(window):
    if hasattr(window, "toggle_file_panel"):
        try:
            window.toggle_file_panel()
            return
        except Exception:
            pass

    panel = getattr(window, "file_panel", None)
    if panel is not None:
        try:
            panel.setVisible(False)
        except Exception:
            pass


def rebuild_file_panel_like_output(window):
    file_panel = getattr(window, "file_panel", None)
    file_list = getattr(window, "file_list", None)

    if file_panel is None or file_list is None:
        return

    layout = file_panel.layout()

    if layout is None:
        layout = QVBoxLayout(file_panel)
        file_panel.setLayout(layout)
    else:
        _clear_layout(layout, keep_widgets={file_list})

    layout.setContentsMargins(18, 18, 18, 18)
    layout.setSpacing(12)

    file_panel.setObjectName("sideFilePanelClean")
    file_panel.setStyleSheet("""
        #sideFilePanelClean {
            background-color: rgba(22, 13, 44, 0.94);
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 20px;
        }

        #sideFilePanelClean QLabel {
            color: white;
            background: transparent;
            border: none;
            font-size: 18px;
            font-weight: 900;
        }

        #sideFilePanelClean QListWidget {
            background-color: rgba(8, 13, 31, 0.94);
            color: #dbeafe;
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 15px;
            padding: 8px;
            font-size: 13px;
        }

        #sideFilePanelClean QListWidget::item {
            padding: 6px;
            border-radius: 8px;
        }

        #sideFilePanelClean QListWidget::item:selected {
            background-color: #2563eb;
            color: white;
        }
    """)

    header = QHBoxLayout()
    header.setContentsMargins(0, 0, 0, 0)
    header.setSpacing(10)

    title = QLabel("File progetto")
    title.setObjectName("sideFilePanelTitle")

    expand_button = QPushButton("\u26f6")
    expand_button.setToolTip("Apri File progetto in grande")
    _button_style(expand_button)
    expand_button.clicked.connect(lambda: open_file_project_big(window))

    close_button = QPushButton("\u00d7")
    close_button.setToolTip("Chiudi File progetto")
    _button_style(close_button)
    close_button.clicked.connect(lambda: _close_file_panel(window))

    header.addWidget(title)
    header.addStretch()
    header.addWidget(expand_button)
    header.addWidget(close_button)

    file_list.setParent(file_panel)
    file_list.show()

    layout.addLayout(header)
    layout.addWidget(file_list, stretch=1)

    window.file_big_button = expand_button
    window.file_close_button = close_button


def apply_compact_topbar(window):
    _style_global(window)

    project_button = getattr(window, "new_project_button", None)
    actions_button = getattr(window, "next_step_button", None)

    if project_button is not None:
        _disconnect_clicked(project_button)
        project_button.setText("Progetto")
        project_button.setObjectName("topDropdownMenuButton")
        project_button.setToolTip("Menu progetto")
        project_button.setMinimumWidth(108)
        project_button.setMaximumWidth(118)
        project_button.setMenu(_make_project_menu(window))

    if actions_button is not None:
        _disconnect_clicked(actions_button)
        actions_button.setText("Step")
        actions_button.setObjectName("topDropdownMenuButton")
        actions_button.setToolTip("Step progetto")
        actions_button.setMinimumWidth(108)
        actions_button.setMaximumWidth(118)
        actions_button.setMenu(_make_actions_menu(window))

    _hide(getattr(window, "open_project_button", None))
    _hide(getattr(window, "save_spec_button", None))
    _hide(getattr(window, "apply_output_button", None))
    _hide(getattr(window, "repair_backend_button", None))
    _hide(getattr(window, "big_output_button", None))

    _compact_label(getattr(window, "project_label", None), 220)
    _compact_label(getattr(window, "step_label", None), 420)
    _compact_label(getattr(window, "status_label", None), 110)

    step_label = getattr(window, "step_label", None)
    if step_label is not None:
        try:
            step_label.setMinimumWidth(260)
            step_label.setMaximumWidth(460)
            step_label.setToolTip(step_label.text())
        except Exception:
            pass

    rebuild_file_panel_like_output(window)


def _walk_layouts_for_pronto(layout):
    if layout is None:
        return

    yield layout

    try:
        count = layout.count()
    except Exception:
        return

    for i in range(count):
        item = layout.itemAt(i)
        if item is None:
            continue

        child_layout = item.layout()
        if child_layout is not None:
            yield from _walk_layouts_for_pronto(child_layout)


def _find_layout_containing_pronto(root_layout, widget):
    if root_layout is None or widget is None:
        return None

    for layout in _walk_layouts_for_pronto(root_layout):
        try:
            if layout.indexOf(widget) >= 0:
                return layout
        except Exception:
            pass

    return None


def _move_widget_to_end_pronto(layout, widget):
    if layout is None or widget is None:
        return

    try:
        if layout.indexOf(widget) >= 0:
            layout.removeWidget(widget)
        layout.addWidget(widget)
    except Exception:
        pass


def _move_widget_before_pronto(layout, widget, reference_widget):
    if layout is None or widget is None or reference_widget is None:
        return False

    try:
        ref_index = layout.indexOf(reference_widget)
        if ref_index < 0:
            return False

        if layout.indexOf(widget) >= 0:
            layout.removeWidget(widget)
            ref_index = layout.indexOf(reference_widget)

        layout.insertWidget(ref_index, widget)
        return True
    except Exception:
        return False


def _polish_status_pronto_right(window):
    status = getattr(window, "status_label", None)

    if status is None:
        return

    try:
        status.setText("Pronto")
        status.setToolTip("Risposta pronta")
        status.setMinimumWidth(78)
        status.setMaximumWidth(92)
    except Exception:
        pass

    try:
        status.setStyleSheet(
            "background-color: rgba(8, 12, 24, 0.62);"
            "color: white;"
            "border: 1px solid rgba(255,255,255,0.16);"
            "border-radius: 14px;"
            "padding: 8px 12px;"
            "font-weight: 800;"
            "font-size: 13px;"
        )
    except Exception:
        pass

    central = window.centralWidget()
    if central is None or central.layout() is None:
        return

    layout = _find_layout_containing_pronto(central.layout(), status)
    if layout is None:
        return

    project_button = getattr(window, "new_project_button", None)
    actions_button = getattr(window, "next_step_button", None)

    # Ordine logico: Progetto prima di Azioni.
    try:
        if project_button is not None and actions_button is not None:
            p_idx = layout.indexOf(project_button)
            a_idx = layout.indexOf(actions_button)

            if p_idx >= 0 and a_idx >= 0 and p_idx > a_idx:
                layout.removeWidget(project_button)
                a_idx = layout.indexOf(actions_button)
                layout.insertWidget(a_idx, project_button)
    except Exception:
        pass

    # Pronto va verso destra. Se Output e' nella stessa barra, Pronto va subito prima di Output.
    output_button = getattr(window, "output_toggle_button", None)

    if output_button is not None:
        if _move_widget_before_pronto(layout, status, output_button):
            return

    _move_widget_to_end_pronto(layout, status)


# === LOCOCODE_FORCE_TOPBAR_ORDER_FINAL_BEGIN ===
def _lc_walk_layouts_final(layout):
    if layout is None:
        return
    yield layout
    try:
        count = layout.count()
    except Exception:
        return
    for i in range(count):
        item = layout.itemAt(i)
        if item is None:
            continue
        child = item.layout()
        if child is not None:
            yield from _lc_walk_layouts_final(child)


def _lc_find_layout_final(window, widget):
    if widget is None:
        return None

    central = window.centralWidget()
    if central is None or central.layout() is None:
        return None

    for layout in _lc_walk_layouts_final(central.layout()):
        try:
            if layout.indexOf(widget) >= 0:
                return layout
        except Exception:
            pass
    return None


def _lc_find_button_text_final(window, wanted):
    try:
        from PySide6.QtWidgets import QPushButton
        central = window.centralWidget()
        if central is None:
            return None
        wanted = wanted.lower()
        for btn in central.findChildren(QPushButton):
            try:
                txt = (btn.text() or "").lower()
            except Exception:
                txt = ""
            if wanted in txt:
                return btn
    except Exception:
        pass
    return None


def _lc_force_topbar_order_final(window):
    # Widget principali. Se l'attributo non basta, cerca per testo visibile.
    project_button = getattr(window, "new_project_button", None) or _lc_find_button_text_final(window, "progetto")
    actions_button = getattr(window, "next_step_button", None) or _lc_find_button_text_final(window, "azioni")
    status = getattr(window, "status_label", None)
    output_button = getattr(window, "output_toggle_button", None)

    # Testi finali.
    try:
        if project_button is not None:
            project_button.setText("Progetto")
            project_button.setMinimumWidth(108)
            project_button.setMaximumWidth(118)
    except Exception:
        pass

    try:
        if actions_button is not None:
            actions_button.setText("Step")
            actions_button.setToolTip("Step progetto")
            actions_button.setMinimumWidth(108)
            actions_button.setMaximumWidth(118)
    except Exception:
        pass

    try:
        if status is not None:
            status.setText("Pronto")
            status.setToolTip("Risposta pronta")
            status.setMinimumWidth(78)
            status.setMaximumWidth(92)
            status.setStyleSheet(
                "background-color: rgba(8, 12, 24, 0.62);"
                "color: white;"
                "border: 1px solid rgba(255,255,255,0.16);"
                "border-radius: 14px;"
                "padding: 8px 12px;"
                "font-weight: 800;"
                "font-size: 13px;"
            )
    except Exception:
        pass

    # Layout di riferimento: quello dove stanno i menu.
    target_layout = _lc_find_layout_final(window, project_button)
    if target_layout is None:
        target_layout = _lc_find_layout_final(window, actions_button)
    if target_layout is None:
        target_layout = _lc_find_layout_final(window, status)
    if target_layout is None:
        return

    widgets = [w for w in [project_button, actions_button, status] if w is not None]

    # Rimuove i tre widget da qualsiasi layout in cui si trovino.
    for w in widgets:
        old_layout = _lc_find_layout_final(window, w)
        if old_layout is not None:
            try:
                old_layout.removeWidget(w)
            except Exception:
                pass

    # Sceglie punto di inserimento.
    insert_index = None

    # Se Output e' nello stesso layout, Progetto/Azioni/Pronto vanno prima di Output.
    if output_button is not None:
        try:
            out_idx = target_layout.indexOf(output_button)
            if out_idx >= 0:
                insert_index = out_idx
        except Exception:
            insert_index = None

    # Altrimenti dopo Step/Fase, se esiste.
    if insert_index is None:
        for attr in ["step_label", "project_label"]:
            anchor = getattr(window, attr, None)
            try:
                idx = target_layout.indexOf(anchor)
                if idx >= 0:
                    insert_index = idx + 1
                    break
            except Exception:
                pass

    # Fallback: in fondo al layout.
    if insert_index is None:
        try:
            insert_index = target_layout.count()
        except Exception:
            insert_index = 0

    # Ordine finale richiesto.
    ordered = [project_button, actions_button, status]
    for offset, w in enumerate([x for x in ordered if x is not None]):
        try:
            target_layout.insertWidget(insert_index + offset, w)
            w.show()
            w.setVisible(True)
        except Exception:
            pass



# Wrappa apply_compact_topbar, cosi' l'ordinamento viene applicato dopo le altre patch grafiche.
try:
    _lc_original_apply_compact_topbar_final = apply_compact_topbar

    def apply_compact_topbar(window):
        _lc_original_apply_compact_topbar_final(window)
        _lc_force_topbar_order_final(window)

except Exception:
    pass
# === LOCOCODE_FORCE_TOPBAR_ORDER_FINAL_END ===


# === LOCOCODE_DARK_MENU_BUTTONS_BEGIN ===
def _lc_force_dark_menu_buttons(window):
    buttons = [
        getattr(window, "new_project_button", None),
        getattr(window, "next_step_button", None),
    ]

    dark_style = """
        QPushButton {
            background-color: rgba(8, 12, 24, 0.72);
            color: white;
            border: 1px solid rgba(255,255,255,0.18);
            border-radius: 14px;
            padding: 8px 14px;
            min-width: 108px;
            max-width: 118px;
            font-weight: 900;
        }

        QPushButton:hover {
            background-color: rgba(255,255,255,0.18);
        }

        QPushButton::menu-indicator {
            image: none;
            width: 0px;
        }
    """

    for button in buttons:
        if button is None:
            continue

        try:
            button.setStyleSheet(dark_style)
            button.setMinimumWidth(108)
            button.setMaximumWidth(118)
        except Exception:
            pass


try:
    _lc_original_apply_compact_topbar_dark_buttons = apply_compact_topbar

    def apply_compact_topbar(window):
        _lc_original_apply_compact_topbar_dark_buttons(window)
        _lc_force_dark_menu_buttons(window)

except Exception:
    pass
# === LOCOCODE_DARK_MENU_BUTTONS_END ===


# === LOCOCODE_FIXED_CLEAN_CHAT_LAYOUT_BEGIN ===
# Layout fisso pulito:
# - niente titoli sulle finestre
# - niente pulsante espandi
# - output centrale fisso con testo scrollabile
# - prompt fisso sotto
# - logo centrale nascosto
try:
    from PySide6.QtCore import Qt as _LCFixedQt
    from PySide6.QtCore import QTimer as _LCFixedTimer
    from PySide6.QtWidgets import QWidget as _LCFixedWidget
    from PySide6.QtWidgets import QLabel as _LCFixedLabel
    from PySide6.QtWidgets import QPushButton as _LCFixedButton
    from PySide6.QtWidgets import QSizePolicy as _LCFixedSizePolicy
except Exception:
    _LCFixedQt = None
    _LCFixedTimer = None
    _LCFixedWidget = None
    _LCFixedLabel = None
    _LCFixedButton = None
    _LCFixedSizePolicy = None


def _lc_fixed_find_widget(window, names):
    if isinstance(names, str):
        names = [names]

    try:
        central = window.centralWidget()
        if central is None or _LCFixedWidget is None:
            return None

        for widget in central.findChildren(_LCFixedWidget):
            try:
                if widget.objectName() in names:
                    return widget
            except Exception:
                pass
    except Exception:
        pass

    return None


def _lc_fixed_prompt_card(window):
    card = _lc_fixed_find_widget(
        window,
        [
            "lovablePromptCard",
            "promptCard",
            "prompt_card",
            "lcPromptCardPolished",
            "lcV2PromptCard",
        ],
    )

    if card is not None:
        return card

    try:
        message_input = getattr(window, "message_input", None)
        if message_input is not None:
            return message_input.parentWidget()
    except Exception:
        pass

    return None


def _lc_fixed_walk_layouts(layout):
    if layout is None:
        return

    yield layout

    try:
        count = layout.count()
    except Exception:
        return

    for i in range(count):
        item = layout.itemAt(i)
        if item is None:
            continue

        child = item.layout()
        if child is not None:
            yield from _lc_fixed_walk_layouts(child)


def _lc_fixed_find_layout(root_layout, widget):
    if root_layout is None or widget is None:
        return None

    for layout in _lc_fixed_walk_layouts(root_layout):
        try:
            if layout.indexOf(widget) >= 0:
                return layout
        except Exception:
            pass

    return None


def _lc_fixed_detach(window, widget):
    if widget is None:
        return

    central = window.centralWidget()
    if central is None or central.layout() is None:
        return

    layout = _lc_fixed_find_layout(central.layout(), widget)
    if layout is not None:
        try:
            layout.removeWidget(widget)
        except Exception:
            pass


def _lc_fixed_hide_center_logo(window):
    candidates = [
        getattr(window, "banner_label", None),
        getattr(window, "hero_banner", None),
        getattr(window, "logo_banner", None),
        _lc_fixed_find_widget(window, ["bannerLabel", "heroBanner", "centerBanner"]),
    ]

    for widget in candidates:
        if widget is None:
            continue

        try:
            if widget.width() < 180 and widget.height() < 120:
                continue
        except Exception:
            pass

        try:
            widget.hide()
            widget.setVisible(False)
            widget.setMaximumHeight(0)
            widget.setMinimumHeight(0)
        except Exception:
            pass


def _lc_fixed_hide_output_toggle(window):
    candidates = [
        getattr(window, "output_toggle_button", None),
        getattr(window, "output_button", None),
    ]

    try:
        central = window.centralWidget()
        if central is not None and _LCFixedButton is not None:
            for button in central.findChildren(_LCFixedButton):
                try:
                    txt = (button.text() or "").strip().lower()
                    pos = button.mapTo(central, button.rect().topLeft())
                except Exception:
                    txt = ""
                    pos = None

                if txt.startswith("output") and pos is not None and pos.y() < 240:
                    candidates.append(button)
    except Exception:
        pass

    for button in candidates:
        if button is None:
            continue

        try:
            button.hide()
            button.setVisible(False)
            button.setMaximumWidth(0)
            button.setMinimumWidth(0)
        except Exception:
            pass


def _lc_fixed_hide_panel_chrome(panel):
    if panel is None:
        return

    # Nasconde titoli tipo "Output", "File progetto" dentro la card.
    if _LCFixedLabel is not None:
        try:
            for label in panel.findChildren(_LCFixedLabel):
                try:
                    txt = (label.text() or "").strip().lower()
                except Exception:
                    txt = ""

                if txt in {"output", "file progetto", "file prog", "file"}:
                    label.hide()
                    label.setVisible(False)
                    label.setMaximumHeight(0)
                    label.setMinimumHeight(0)
        except Exception:
            pass

    # Nasconde espandi e chiudi: la finestra e' fissa.
    if _LCFixedButton is not None:
        try:
            for button in panel.findChildren(_LCFixedButton):
                try:
                    txt = (button.text() or "").strip().lower()
                except Exception:
                    txt = ""

                if txt in {"\u26f6", "\u00d7", "x", "apri file", "apri"}:
                    button.hide()
                    button.setVisible(False)
                    button.setMaximumWidth(0)
                    button.setMinimumWidth(0)
                    button.setMaximumHeight(0)
                    button.setMinimumHeight(0)
        except Exception:
            pass


def _lc_fixed_scroll_text(output_text):
    if output_text is None or _LCFixedQt is None:
        return

    try:
        output_text.setVerticalScrollBarPolicy(_LCFixedQt.ScrollBarAsNeeded)
        output_text.setHorizontalScrollBarPolicy(_LCFixedQt.ScrollBarAsNeeded)
    except Exception:
        pass

    try:
        output_text.setMinimumHeight(0)
        output_text.setMaximumHeight(9999)
    except Exception:
        pass

    try:
        output_text.setViewportMargins(0, 0, 0, 14)
        output_text.document().setDocumentMargin(16)
    except Exception:
        pass


def _lc_fixed_apply_styles(output_panel, output_text, prompt_card):
    if output_panel is not None:
        try:
            output_panel.setObjectName("lcFixedOutputPanel")
            if _LCFixedQt is not None:
                output_panel.setAttribute(_LCFixedQt.WA_StyledBackground, True)
            output_panel.setStyleSheet("""
                QWidget#lcFixedOutputPanel,
                QFrame#lcFixedOutputPanel {
                    background-color: rgba(31, 31, 29, 0.97);
                    border: 1px solid rgba(255,255,255,0.12);
                    border-radius: 28px;
                }

                QWidget#lcFixedOutputPanel QTextEdit,
                QWidget#lcFixedOutputPanel QPlainTextEdit,
                QFrame#lcFixedOutputPanel QTextEdit,
                QFrame#lcFixedOutputPanel QPlainTextEdit {
                    background-color: transparent;
                    color: #f2f5ff;
                    border: none;
                    border-radius: 22px;
                    padding: 18px 20px;
                    font-size: 14px;
                    selection-background-color: #2563eb;
                }

                QWidget#lcFixedOutputPanel QLabel,
                QFrame#lcFixedOutputPanel QLabel {
                    background: transparent;
                    border: none;
                    color: transparent;
                    font-size: 0px;
                    min-height: 0px;
                    max-height: 0px;
                    padding: 0px;
                    margin: 0px;
                }

                QWidget#lcFixedOutputPanel QPushButton,
                QFrame#lcFixedOutputPanel QPushButton {
                    background: transparent;
                    border: none;
                    color: transparent;
                    min-width: 0px;
                    max-width: 0px;
                    min-height: 0px;
                    max-height: 0px;
                    padding: 0px;
                    margin: 0px;
                }
            """)
        except Exception:
            pass

    if prompt_card is not None:
        try:
            prompt_card.setObjectName("lcFixedPromptCard")
            if _LCFixedQt is not None:
                prompt_card.setAttribute(_LCFixedQt.WA_StyledBackground, True)
            prompt_card.setStyleSheet("""
                QWidget#lcFixedPromptCard,
                QFrame#lcFixedPromptCard {
                    background-color: #242421;
                    border: 1px solid rgba(255,255,255,0.12);
                    border-radius: 28px;
                }

                QWidget#lcFixedPromptCard QLineEdit,
                QWidget#lcFixedPromptCard QTextEdit,
                QWidget#lcFixedPromptCard QPlainTextEdit,
                QFrame#lcFixedPromptCard QLineEdit,
                QFrame#lcFixedPromptCard QTextEdit,
                QFrame#lcFixedPromptCard QPlainTextEdit {
                    background: transparent;
                    color: #f7f7f2;
                    border: none;
                    font-size: 16px;
                    padding: 6px 10px;
                    selection-background-color: #2563eb;
                }

                QWidget#lcFixedPromptCard QLabel,
                QFrame#lcFixedPromptCard QLabel {
                    color: rgba(255,255,255,0.70);
                    background: transparent;
                    border: none;
                    font-size: 13px;
                    font-weight: 800;
                }

                QWidget#lcFixedPromptCard QPushButton,
                QFrame#lcFixedPromptCard QPushButton {
                    background-color: transparent;
                    color: rgba(255,255,255,0.76);
                    border: 1px solid transparent;
                    border-radius: 18px;
                    padding: 0px;
                    font-weight: 800;
                }

                QWidget#lcFixedPromptCard QPushButton:hover,
                QFrame#lcFixedPromptCard QPushButton:hover {
                    background-color: rgba(255,255,255,0.16);
                }

                QWidget#lcFixedPromptCard QComboBox,
                QFrame#lcFixedPromptCard QComboBox {
                    background-color: rgba(12, 12, 12, 0.50);
                    color: rgba(255,255,255,0.88);
                    border: 1px solid rgba(255,255,255,0.12);
                    border-radius: 15px;
                    padding: 5px 12px;
                    font-size: 13px;
                    font-weight: 800;
                }

                QWidget#lcFixedPromptCard QComboBox:hover,
                QFrame#lcFixedPromptCard QComboBox:hover {
                    background-color: rgba(255,255,255,0.08);
                    border-color: rgba(255,255,255,0.20);
                }
            """)
        except Exception:
            pass


def _lc_fixed_compact_prompt_controls(window, prompt_card):
    def remove_spacers(layout):
        if layout is None:
            return

        index = 0
        while index < layout.count():
            item = layout.itemAt(index)
            if item is None:
                index += 1
                continue

            if item.spacerItem() is not None:
                layout.takeAt(index)
                continue

            child_layout = item.layout()
            if child_layout is not None:
                remove_spacers(child_layout)

            index += 1

    try:
        layout = prompt_card.layout()
        if layout is not None:
            layout.setContentsMargins(26, 16, 26, 16)
            layout.setSpacing(12)
            remove_spacers(layout)
    except Exception:
        pass

    try:
        provider = getattr(window, "provider_combo", None)
        layout = prompt_card.layout()
        if provider is not None and layout is not None and _LCFixedQt is not None:
            for i in range(layout.count()):
                item = layout.itemAt(i)
                child_layout = item.layout() if item is not None else None
                if child_layout is not None and child_layout.indexOf(provider) >= 0:
                    child_layout.setAlignment(_LCFixedQt.AlignCenter)
    except Exception:
        pass

    for attr in ["message_input"]:
        widget = getattr(window, attr, None)
        if widget is None:
            continue
        try:
            widget.setMinimumHeight(78)
            widget.setMaximumHeight(128)
            if _LCFixedQt is not None:
                widget.setVerticalScrollBarPolicy(_LCFixedQt.ScrollBarAsNeeded)
                widget.setHorizontalScrollBarPolicy(_LCFixedQt.ScrollBarAlwaysOff)
        except Exception:
            pass

    add_button = getattr(window, "add_file_button", None)
    if add_button is not None:
        try:
            add_button.setText("+")
            add_button.setFixedSize(36, 36)
            add_button.setStyleSheet("""
                QPushButton {
                    background-color: transparent;
                    color: rgba(255,255,255,0.58);
                    border: 1px solid transparent;
                    border-radius: 18px;
                    font-size: 24px;
                    font-weight: 400;
                    padding: 0px;
                }
                QPushButton:hover {
                    background-color: rgba(255,255,255,0.08);
                    color: #ffffff;
                }
            """)
        except Exception:
            pass

    mic_button = getattr(window, "mic_button", None)
    if mic_button is not None:
        try:
            mic_button.hide()
            mic_button.setVisible(False)
            mic_button.setFixedSize(0, 0)
            mic_button.setMaximumWidth(0)
        except Exception:
            pass

    send_button = getattr(window, "send_button", None)
    if send_button is not None:
        try:
            send_button.setText("↑")
            send_button.setFixedSize(38, 38)
            send_button.setStyleSheet("""
                QPushButton {
                    background-color: rgba(255,255,255,0.58);
                    color: #111111;
                    border: none;
                    border-radius: 19px;
                    font-size: 20px;
                    font-weight: 900;
                    padding: 0px;
                }
                QPushButton:hover {
                    background-color: rgba(255,255,255,0.78);
                }
            """)
        except Exception:
            pass

    for attr in ["provider_combo", "model_combo", "agent_combo"]:
        widget = getattr(window, attr, None)
        if widget is None:
            continue
        try:
            widget.setMinimumHeight(36)
            widget.setMaximumHeight(38)
        except Exception:
            pass

    attachments_label = getattr(window, "attachments_label", None)
    if attachments_label is not None:
        try:
            attachments_label.setMinimumHeight(0)
            attachments_label.setMaximumHeight(78)
            attachments_label.setStyleSheet(
                "background: transparent; border: none; "
                "color: rgba(255,255,255,0.72); font-size: 12px; padding: 0px 8px 4px 8px;"
            )
        except Exception:
            pass

    reference_hint = getattr(window, "reference_hint_label", None)
    if reference_hint is not None:
        try:
            reference_hint.hide()
            reference_hint.setVisible(False)
            reference_hint.setMinimumHeight(0)
            reference_hint.setMaximumHeight(0)
        except Exception:
            pass


def _lc_fixed_layout(window):
    central = window.centralWidget()
    if central is None:
        return

    output_panel = getattr(window, "output_panel", None)
    output_text = getattr(window, "output_text", None) or getattr(window, "chat_area", None)
    prompt_card = _lc_fixed_prompt_card(window)
    work_status = getattr(window, "work_status_label", None)
    brand_banner = getattr(window, "brand_banner_label", None)
    file_panel = getattr(window, "file_panel", None)
    file_button = getattr(window, "file_toggle_button", None)

    if output_panel is None or prompt_card is None:
        return

    right_col = getattr(window, "right_col", None)
    if right_col is not None:
        try:
            right_col.hide()
            right_col.setVisible(False)
            right_col.setMinimumWidth(0)
            right_col.setMaximumWidth(0)
        except Exception:
            pass

    _lc_fixed_hide_center_logo(window)
    _lc_fixed_hide_output_toggle(window)
    _lc_fixed_hide_panel_chrome(output_panel)
    _lc_fixed_scroll_text(output_text)
    _lc_fixed_apply_styles(output_panel, output_text, prompt_card)
    _lc_fixed_compact_prompt_controls(window, prompt_card)

    _lc_fixed_detach(window, output_panel)
    _lc_fixed_detach(window, prompt_card)

    try:
        output_panel.setParent(central)
        prompt_card.setParent(central)
        if work_status is not None:
            work_status.setParent(central)
        if brand_banner is not None:
            brand_banner.setParent(central)
    except Exception:
        pass

    try:
        win_w = max(900, central.width())
        win_h = max(620, central.height())

        sidebar_w = 0
        if file_panel is not None:
            try:
                file_panel.setVisible(False)
            except Exception:
                pass

        left_margin = 18
        right_margin = max(18, int(win_w * 0.025))
        gap = 28 if sidebar_w else 0
        try:
            left_panel = getattr(window, "left_col", None)
            left_menu_reserved_w = (left_panel.width() + 24) if left_panel is not None else 325
            if getattr(window, "left_sidebar_collapsed", False):
                left_menu_reserved_w = 70
        except Exception:
            left_menu_reserved_w = 325

        content_x = max(left_menu_reserved_w, left_margin + sidebar_w + gap)
        content_w = max(520, win_w - content_x - right_margin)

        max_card_w = min(1120, int(win_w * (0.70 if sidebar_w else 0.74)))
        min_card_w = min(680, max(500, content_w - 24))
        card_w = min(max_card_w, max(min_card_w, int(content_w * 0.78)))
        card_w = min(card_w, content_w)
        card_x = content_x + int((content_w - card_w) / 2)

        bottom_margin = max(46, min(68, int(win_h * 0.065)))
        has_image_preview = False
        try:
            for path in getattr(window, "attached_files", []) or []:
                if str(path).lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp")):
                    has_image_preview = True
                    break
        except Exception:
            has_image_preview = False

        if has_image_preview:
            prompt_h = max(190, min(235, int(win_h * 0.24)))
        else:
            prompt_h = max(138, min(178, int(win_h * 0.17)))
        output_gap = 0
        status_h = 0
        status_gap = 0

        banner_y = max(92, min(122, int(win_h * 0.12)))
        banner_h = max(82, min(124, int(win_h * 0.13)))
        top_y = banner_y + banner_h + max(14, min(22, int(win_h * 0.02)))

        available_h = win_h - top_y - bottom_margin - prompt_h - output_gap - status_h - status_gap - 12
        output_h = max(150, min(330, int(win_h * 0.34), available_h))
        status_y = top_y + output_h + output_gap
        prompt_y = status_y + status_h + status_gap

        if brand_banner is not None:
            brand_banner.setGeometry(card_x, banner_y, card_w, banner_h)

            try:
                original = getattr(window, "brand_banner_original", None)
                if original is not None and not original.isNull():
                    brand_banner.setPixmap(original.scaled(
                        card_w,
                        banner_h,
                        Qt.KeepAspectRatio,
                        Qt.SmoothTransformation,
                    ))
            except Exception:
                pass

            brand_banner.show()
            brand_banner.setVisible(True)

        output_panel.setGeometry(card_x, top_y, card_w, output_h)
        if work_status is not None:
            work_status.setGeometry(card_x + 12, status_y, max(240, card_w - 24), 0)
            work_status.hide()
            work_status.setVisible(False)
        prompt_card.setMinimumWidth(card_w)
        prompt_card.setMaximumWidth(card_w)
        prompt_card.setMinimumHeight(prompt_h)
        prompt_card.setMaximumHeight(prompt_h)
        prompt_card.setGeometry(card_x, prompt_y, card_w, prompt_h)

        if _LCFixedSizePolicy is not None:
            output_panel.setSizePolicy(_LCFixedSizePolicy.Fixed, _LCFixedSizePolicy.Fixed)
            prompt_card.setSizePolicy(_LCFixedSizePolicy.Fixed, _LCFixedSizePolicy.Fixed)

        output_panel.show()
        prompt_card.show()
        output_panel.setVisible(True)
        prompt_card.setVisible(True)
        if brand_banner is not None:
            brand_banner.raise_()
        output_panel.raise_()
        if work_status is not None:
            work_status.raise_()
        prompt_card.raise_()

    except Exception:
        pass


def _lc_fixed_resize_hook(window):
    if getattr(window, "_lc_fixed_resize_hook_installed", False):
        return

    original_resize = getattr(window, "resizeEvent", None)

    def resizeEvent(event):
        try:
            if original_resize is not None:
                original_resize(event)
        except Exception:
            pass

        try:
            if _LCFixedTimer is not None:
                _LCFixedTimer.singleShot(0, lambda: _lc_fixed_layout(window))
            else:
                _lc_fixed_layout(window)
        except Exception:
            pass

    try:
        window.resizeEvent = resizeEvent
        window._lc_fixed_resize_hook_installed = True
    except Exception:
        pass


def _lc_fixed_clean_chat_layout(window):
    try:
        window.refresh_compact_layout = lambda: _lc_fixed_layout(window)
    except Exception:
        pass

    _lc_fixed_resize_hook(window)
    _lc_fixed_layout(window)

    if _LCFixedTimer is not None:
        _LCFixedTimer.singleShot(150, lambda: _lc_fixed_layout(window))
        _LCFixedTimer.singleShot(650, lambda: _lc_fixed_layout(window))

def _lc_fixed_schedule_layout(window):
    try:
        if _LCFixedTimer is not None:
            _LCFixedTimer.singleShot(0, lambda: _lc_fixed_layout(window))
            _LCFixedTimer.singleShot(120, lambda: _lc_fixed_layout(window))
        else:
            _lc_fixed_layout(window)
    except Exception:
        pass


def _lc_fixed_install_file_panel_hook(window):
    if getattr(window, "_lc_fixed_file_panel_hook_installed", False):
        return

    def toggle_file_panel(*args, **kwargs):
        dialog = getattr(window, "file_project_floating_dialog", None)

        try:
            if dialog is not None and dialog.isVisible():
                dialog.close()
                return None
        except Exception:
            pass

        open_file_project_floating(window)

        try:
            menu_button = getattr(window, "file_toggle_button", None)
            if menu_button is not None:
                menu_button.setText("Menu")
                menu_button.setMenu(_make_left_command_menu(window))
        except Exception:
            pass
        _lc_fixed_schedule_layout(window)
        return None

    try:
        window.toggle_file_panel = toggle_file_panel
        window._lc_fixed_file_panel_hook_installed = True
    except Exception:
        pass


try:
    _lc_original_apply_compact_topbar_fixed_clean = apply_compact_topbar

    def apply_compact_topbar(window):
        _lc_original_apply_compact_topbar_fixed_clean(window)
        _lc_fixed_install_file_panel_hook(window)
        _lc_fixed_clean_chat_layout(window)

except Exception:
    pass
# === LOCOCODE_FIXED_CLEAN_CHAT_LAYOUT_END ===


# === LOCOCODE_LEFT_COMMAND_MENU_BEGIN ===
def _lc_apply_left_command_menu(window):
    menu_button = getattr(window, "file_toggle_button", None)

    if menu_button is None:
        return

    if getattr(window, "sidebar_toggle_button", None) is not None:
        _hide(menu_button)

        for attr in [
            "new_project_button",
            "next_step_button",
            "open_project_button",
            "save_spec_button",
            "apply_output_button",
            "repair_backend_button",
            "big_output_button",
        ]:
            _hide(getattr(window, attr, None))

        return

    try:
        _disconnect_clicked(menu_button)
        menu_button.setText("Menu")
        menu_button.setObjectName("leftCommandMenuButton")
        menu_button.setToolTip("Menu principale LocoCode")
        menu_button.setMinimumWidth(270)
        menu_button.setMaximumWidth(285)
        menu_button.setMinimumHeight(44)
        menu_button.setMaximumHeight(46)
        menu_button.setMenu(_make_left_command_menu(window))
        menu_button.show()
        menu_button.setVisible(True)
    except Exception:
        pass

    # Le stesse azioni ora stanno nel menu laterale.
    for attr in [
        "new_project_button",
        "next_step_button",
        "open_project_button",
        "save_spec_button",
        "apply_output_button",
        "repair_backend_button",
        "big_output_button",
    ]:
        _hide(getattr(window, attr, None))

    try:
        window.left_command_menu_button = menu_button
    except Exception:
        pass


try:
    _lc_original_apply_compact_topbar_left_menu = apply_compact_topbar

    def apply_compact_topbar(window):
        _lc_original_apply_compact_topbar_left_menu(window)
        _lc_apply_left_command_menu(window)

except Exception:
    pass
# === LOCOCODE_LEFT_COMMAND_MENU_END ===

