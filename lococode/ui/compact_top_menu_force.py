from PySide6.QtWidgets import QMenu, QPushButton


ACTION_KEYWORDS = [
    "prossimo",
    "nuovo",
    "apri",
    "salva",
    "applica",
    "ripara",
]


def _walk_layouts(layout):
    if layout is None:
        return

    yield layout

    for i in range(layout.count()):
        item = layout.itemAt(i)
        child_layout = item.layout()

        if child_layout is not None:
            yield from _walk_layouts(child_layout)


def _find_layout_containing(root_layout, widget):
    if root_layout is None or widget is None:
        return None

    for layout in _walk_layouts(root_layout):
        try:
            if layout.indexOf(widget) >= 0:
                return layout
        except Exception:
            pass

    return None


def _remove_widget_from_layout(root_layout, widget):
    layout = _find_layout_containing(root_layout, widget)

    if layout is not None:
        try:
            layout.removeWidget(widget)
        except Exception:
            pass

    try:
        widget.hide()
        widget.setVisible(False)
    except Exception:
        pass


def _button_text(button):
    try:
        return (button.text() or "").strip()
    except Exception:
        return ""


def _add_action(menu, title, callback, enabled=True):
    action = menu.addAction(title)
    action.setEnabled(enabled)

    if callback is not None:
        action.triggered.connect(callback)

    return action


def _find_top_action_buttons(window):
    central = window.centralWidget()

    if central is None or central.layout() is None:
        return None, []

    all_buttons = central.findChildren(QPushButton)

    candidates = []

    for button in all_buttons:
        text = _button_text(button)
        low = text.lower()

        if not text:
            continue

        if "output" in low:
            # Output resta separato a destra.
            continue

        if any(key in low for key in ACTION_KEYWORDS):
            layout = _find_layout_containing(central.layout(), button)

            if layout is not None:
                candidates.append((button, layout, text))

    if not candidates:
        return None, []

    # Sceglie il layout che contiene più pulsanti azione: quasi certamente la barra alta.
    counts = {}

    for _, layout, _ in candidates:
        counts[layout] = counts.get(layout, 0) + 1

    top_layout = max(counts, key=counts.get)

    buttons = [button for button, layout, _ in candidates if layout is top_layout]

    # Ordina secondo posizione nel layout.
    buttons.sort(key=lambda b: top_layout.indexOf(b))

    return top_layout, buttons


def install_compact_menu_force(window):
    if getattr(window, "_compact_menu_force_installed", False):
        print("Compact force menu: già installato.")
        return

    central = window.centralWidget()

    if central is None or central.layout() is None:
        print("Compact force menu: central layout non trovato.")
        return

    top_layout, buttons = _find_top_action_buttons(window)

    if top_layout is None or not buttons:
        print("Compact force menu: pulsanti azione non trovati.")
        return

    indexes = []

    for button in buttons:
        idx = top_layout.indexOf(button)
        if idx >= 0:
            indexes.append(idx)

    insert_index = min(indexes) if indexes else 0

    project_button = QPushButton("Progetto ▾")
    project_button.setObjectName("topMenuButtonForce")
    project_menu = QMenu(window)

    if hasattr(window, "create_new_ai_project"):
        _add_action(project_menu, "Nuovo progetto AI", window.create_new_ai_project)

    if hasattr(window, "open_project_folder"):
        _add_action(project_menu, "Apri progetto", window.open_project_folder)

    project_button.setMenu(project_menu)

    actions_button = QPushButton("Azioni ▾")
    actions_button.setObjectName("topMenuButtonForce")
    actions_menu = QMenu(window)

    if hasattr(window, "run_next_step"):
        _add_action(actions_menu, "Prossimo step", window.run_next_step)

    if hasattr(window, "save_current_spec"):
        _add_action(actions_menu, "Salva SPEC", window.save_current_spec)

    if hasattr(window, "apply_last_ai_response_as_files"):
        action_apply = _add_action(actions_menu, "Applica output", window.apply_last_ai_response_as_files)
        window.action_apply_output = action_apply

    if hasattr(window, "repair_backend_basics"):
        _add_action(actions_menu, "Ripara backend", window.repair_backend_basics)

    if hasattr(window, "open_big_output"):
        actions_menu.addSeparator()
        _add_action(actions_menu, "Output grande", window.open_big_output)

    actions_button.setMenu(actions_menu)

    for button in buttons:
        _remove_widget_from_layout(central.layout(), button)

    # Se esiste un pulsante Output grande separato, nascondilo.
    for button in central.findChildren(QPushButton):
        if "output grande" in _button_text(button).lower():
            _remove_widget_from_layout(central.layout(), button)

    top_layout.insertWidget(insert_index, project_button)
    top_layout.insertWidget(insert_index + 1, actions_button)

    window.project_menu_button = project_button
    window.actions_menu_button = actions_button
    window.project_menu = project_menu
    window.actions_menu = actions_menu
    window._compact_menu_force_installed = True

    # Riduce solo i badge, non li elimina.
    for attr, width in [
        ("project_label", 205),
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

    extra_style = """
        #topMenuButtonForce {
            background-color: rgba(8, 12, 24, 0.72);
            color: white;
            border: 1px solid rgba(255,255,255,0.18);
            border-radius: 14px;
            padding: 8px 14px;
            min-width: 96px;
            font-weight: 900;
        }

        #topMenuButtonForce:hover {
            background-color: rgba(255,255,255,0.22);
        }

        #topMenuButtonForce::menu-indicator {
            image: none;
            width: 0px;
        }

        QMenu {
            background-color: #111827;
            color: white;
            border: 1px solid rgba(255,255,255,0.18);
            border-radius: 10px;
            padding: 6px;
        }

        QMenu::item {
            padding: 9px 28px 9px 14px;
            border-radius: 8px;
        }

        QMenu::item:selected {
            background-color: #2563eb;
        }

        QMenu::separator {
            height: 1px;
            background: rgba(255,255,255,0.14);
            margin: 6px 8px;
        }
    """

    try:
        window.setStyleSheet(window.styleSheet() + extra_style)
    except Exception:
        pass

    print("Compact force menu: installato correttamente.")
