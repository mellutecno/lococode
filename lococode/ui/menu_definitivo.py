from PySide6.QtWidgets import QMenu, QPushButton
from PySide6.QtCore import QPoint


ACTION_WORDS = [
    "prossimo",
    "rossimo",
    "nuovo",
    "apri",
    "salva",
    "applica",
    "ripara",
]


def _text(widget):
    try:
        return (widget.text() or "").strip()
    except Exception:
        return ""


def _button_pos_in_window(window, button):
    try:
        return button.mapTo(window, QPoint(0, 0))
    except Exception:
        try:
            return button.pos()
        except Exception:
            return QPoint(9999, 9999)


def _walk_layouts(layout):
    if layout is None:
        return

    yield layout

    for i in range(layout.count()):
        item = layout.itemAt(i)
        child = item.layout()
        if child is not None:
            yield from _walk_layouts(child)


def _find_layout(window, widget):
    central = window.centralWidget()

    if central is None or central.layout() is None:
        return None

    for layout in _walk_layouts(central.layout()):
        try:
            if layout.indexOf(widget) >= 0:
                return layout
        except Exception:
            pass

    try:
        parent = widget.parentWidget()
        if parent is not None and parent.layout() is not None:
            if parent.layout().indexOf(widget) >= 0:
                return parent.layout()
    except Exception:
        pass

    return None


def _hide_button(window, button):
    layout = _find_layout(window, button)

    if layout is not None:
        try:
            layout.removeWidget(button)
        except Exception:
            pass

    try:
        button.hide()
        button.setVisible(False)
        button.setMaximumWidth(0)
        button.setMinimumWidth(0)
    except Exception:
        pass


def _add_action(menu, title, callback, enabled=True):
    action = menu.addAction(title)
    action.setEnabled(enabled)

    if callback is not None:
        action.triggered.connect(callback)

    return action


def _find_action_buttons(window):
    central = window.centralWidget()
    if central is None:
        return []

    buttons = central.findChildren(QPushButton)
    found = []

    for button in buttons:
        label = _text(button)
        low = label.lower()
        pos = _button_pos_in_window(window, button)

        if not label:
            continue

        # Non tocchiamo Output e File progetto.
        if "output" in low and "grande" not in low:
            continue

        if "file progetto" in low:
            continue

        # Evita i bottoni piccoli del prompt.
        if label in ["+", "↑", "...", "…", "⛶", "×"]:
            continue

        is_named_action = any(word in low for word in ACTION_WORDS)

        # Bottoni nella barra alta: y piccolo, dimensioni da tab/pulsante.
        is_top_button = pos.y() <= 130 and button.width() >= 55 and button.height() >= 24

        if is_named_action or is_top_button:
            found.append(button)

    found.sort(key=lambda b: (_button_pos_in_window(window, b).y(), _button_pos_in_window(window, b).x()))
    return found


def _best_layout_for_buttons(window, buttons):
    counts = {}

    for button in buttons:
        layout = _find_layout(window, button)

        if layout is not None:
            counts[layout] = counts.get(layout, 0) + 1

    if not counts:
        return None

    return max(counts, key=counts.get)


def _style(window):
    css = '''
        #topMenuButtonDefinitivo {
            background-color: rgba(8, 12, 24, 0.78);
            color: white;
            border: 1px solid rgba(255,255,255,0.20);
            border-radius: 14px;
            padding: 8px 14px;
            min-width: 98px;
            font-weight: 900;
        }

        #topMenuButtonDefinitivo:hover {
            background-color: rgba(255,255,255,0.22);
        }

        #topMenuButtonDefinitivo::menu-indicator {
            image: none;
            width: 0px;
        }

        QMenu {
            background-color: #111827;
            color: white;
            border: 1px solid rgba(255,255,255,0.20);
            border-radius: 10px;
            padding: 6px;
        }

        QMenu::item {
            padding: 9px 30px 9px 14px;
            border-radius: 8px;
        }

        QMenu::item:selected {
            background-color: #2563eb;
        }

        QMenu::separator {
            height: 1px;
            background: rgba(255,255,255,0.15);
            margin: 6px 8px;
        }
    '''

    try:
        window.setStyleSheet(window.styleSheet() + css)
    except Exception:
        pass


def _make_menu_buttons(window):
    project_button = QPushButton("Progetto ▾")
    project_button.setObjectName("topMenuButtonDefinitivo")
    project_menu = QMenu(window)

    if hasattr(window, "create_new_ai_project"):
        _add_action(project_menu, "Nuovo progetto AI", window.create_new_ai_project)

    if hasattr(window, "open_project_folder"):
        _add_action(project_menu, "Apri progetto", window.open_project_folder)

    project_button.setMenu(project_menu)

    actions_button = QPushButton("Azioni ▾")
    actions_button.setObjectName("topMenuButtonDefinitivo")
    actions_menu = QMenu(window)

    if hasattr(window, "run_next_step"):
        _add_action(actions_menu, "Prossimo step", window.run_next_step)

    if hasattr(window, "save_current_spec"):
        _add_action(actions_menu, "Salva SPEC", window.save_current_spec)

    if hasattr(window, "apply_last_ai_response_as_files"):
        apply_action = _add_action(actions_menu, "Applica output", window.apply_last_ai_response_as_files, enabled=True)
        window.action_apply_output = apply_action

    if hasattr(window, "repair_backend_basics"):
        _add_action(actions_menu, "Ripara backend", window.repair_backend_basics)

    if hasattr(window, "open_big_output"):
        actions_menu.addSeparator()
        _add_action(actions_menu, "Output grande", window.open_big_output)

    actions_button.setMenu(actions_menu)

    window.project_menu_button = project_button
    window.actions_menu_button = actions_button
    window.project_menu = project_menu
    window.actions_menu = actions_menu

    return project_button, actions_button


def install_menu_definitivo(window):
    if getattr(window, "_menu_definitivo_installato", False):
        print("Menu definitivo: già installato.")
        return

    central = window.centralWidget()

    if central is None:
        print("Menu definitivo: central widget non trovato.")
        return

    _style(window)

    buttons = _find_action_buttons(window)
    print("Menu definitivo: pulsanti trovati =", [_text(b) for b in buttons])

    project_button, actions_button = _make_menu_buttons(window)
    layout = _best_layout_for_buttons(window, buttons)

    if layout is not None and buttons:
        indexes = []

        for button in buttons:
            try:
                idx = layout.indexOf(button)
                if idx >= 0:
                    indexes.append(idx)
            except Exception:
                pass

        insert_index = min(indexes) if indexes else 0

        for button in buttons:
            _hide_button(window, button)

        layout.insertWidget(insert_index, project_button)
        layout.insertWidget(insert_index + 1, actions_button)

        print("Menu definitivo: installato nel layout principale.")
    else:
        for button in buttons:
            _hide_button(window, button)

        project_button.setParent(central)
        actions_button.setParent(central)

        project_button.move(440, 18)
        actions_button.move(555, 18)

        project_button.show()
        actions_button.show()
        project_button.raise_()
        actions_button.raise_()

        print("Menu definitivo: installato come overlay.")

    for attr, width in [
        ("project_label", 210),
        ("step_label", 120),
        ("status_label", 105),
    ]:
        widget = getattr(window, attr, None)

        if widget is not None:
            try:
                widget.setMaximumWidth(width)
                widget.setToolTip(widget.text())
            except Exception:
                pass

    window._menu_definitivo_installato = True
