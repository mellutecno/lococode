from PySide6.QtWidgets import QMenu, QPushButton


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


def _safe_remove(layout, widget):
    if widget is None:
        return

    try:
        if layout is not None:
            layout.removeWidget(widget)
    except Exception:
        pass

    try:
        widget.setVisible(False)
    except Exception:
        pass


def _add_action(menu, title, callback, enabled=True):
    action = menu.addAction(title)
    action.setEnabled(enabled)

    if callback is not None:
        action.triggered.connect(callback)

    return action


def install_compact_menu(window):
    if getattr(window, "_compact_menu_installed", False):
        print("Compact menu: già installato.")
        return

    central = window.centralWidget()

    if central is None or central.layout() is None:
        print("Compact menu: central layout non trovato.")
        return

    anchor_widgets = [
        getattr(window, "next_step_button", None),
        getattr(window, "new_project_button", None),
        getattr(window, "open_project_button", None),
        getattr(window, "save_spec_button", None),
        getattr(window, "apply_output_button", None),
        getattr(window, "repair_backend_button", None),
    ]

    top_layout = None

    for widget in anchor_widgets:
        top_layout = _find_layout_containing(central.layout(), widget)
        if top_layout is not None:
            break

    if top_layout is None:
        print("Compact menu: barra alta non trovata.")
        return

    indexes = []

    for widget in anchor_widgets:
        if widget is None:
            continue

        try:
            idx = top_layout.indexOf(widget)
            if idx >= 0:
                indexes.append(idx)
        except Exception:
            pass

    insert_index = min(indexes) if indexes else max(0, top_layout.count() - 1)

    project_button = QPushButton("Progetto ▾")
    project_button.setObjectName("topMenuButton")
    project_menu = QMenu(window)

    if hasattr(window, "create_new_ai_project"):
        _add_action(project_menu, "Nuovo progetto AI", window.create_new_ai_project)

    if hasattr(window, "open_project_folder"):
        _add_action(project_menu, "Apri progetto", window.open_project_folder)

    project_button.setMenu(project_menu)

    actions_button = QPushButton("Azioni ▾")
    actions_button.setObjectName("topMenuButton")
    actions_menu = QMenu(window)

    if hasattr(window, "run_next_step"):
        _add_action(actions_menu, "Prossimo step", window.run_next_step)

    if hasattr(window, "save_current_spec"):
        _add_action(actions_menu, "Salva SPEC", window.save_current_spec)

    if hasattr(window, "apply_last_ai_response_as_files"):
        apply_action = _add_action(actions_menu, "Applica output", window.apply_last_ai_response_as_files)
        window.action_apply_output = apply_action

    if hasattr(window, "repair_backend_basics"):
        _add_action(actions_menu, "Ripara backend", window.repair_backend_basics)

    if hasattr(window, "open_big_output"):
        actions_menu.addSeparator()
        _add_action(actions_menu, "Apri output grande", window.open_big_output)

    actions_button.setMenu(actions_menu)

    for widget in anchor_widgets:
        _safe_remove(top_layout, widget)

    if hasattr(window, "big_output_button"):
        _safe_remove(_find_layout_containing(central.layout(), window.big_output_button), window.big_output_button)

    top_layout.insertWidget(insert_index, project_button)
    top_layout.insertWidget(insert_index + 1, actions_button)

    window.project_menu_button = project_button
    window.actions_menu_button = actions_button
    window.project_menu = project_menu
    window.actions_menu = actions_menu
    window._compact_menu_installed = True

    for attr, width in [
        ("project_label", 220),
        ("step_label", 130),
        ("status_label", 110),
    ]:
        widget = getattr(window, attr, None)

        if widget is not None:
            try:
                widget.setMaximumWidth(width)
                widget.setToolTip(widget.text())
            except Exception:
                pass

    extra_style = """
        #topMenuButton {
            background-color: rgba(8, 12, 24, 0.68);
            color: white;
            border: 1px solid rgba(255,255,255,0.16);
            border-radius: 14px;
            padding: 8px 14px;
            min-width: 96px;
            font-weight: 800;
        }

        #topMenuButton:hover {
            background-color: rgba(255,255,255,0.20);
        }

        #topMenuButton::menu-indicator {
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

    print("Compact menu: installato correttamente.")
