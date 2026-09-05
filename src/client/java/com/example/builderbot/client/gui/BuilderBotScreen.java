package com.example.builderbot.client.gui;

import com.example.builderbot.build.BuildPlan;
import com.example.builderbot.build.SchematicManager;
import com.example.builderbot.entity.BuilderBotEntity;
import net.fabricmc.api.EnvType;
import net.fabricmc.api.Environment;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

@Environment(EnvType.CLIENT)
public class BuilderBotScreen extends Screen {

    private final net.minecraft.world.entity.Entity bot;

    // Tabs: 0 = Schematics, 1 = Swarm Fleet & Tools
    private int currentTab = 0;

    // Schematics list & scrolling
    private List<File> allSchematicFiles = new ArrayList<>();
    private List<File> filteredSchematicFiles = new ArrayList<>();
    private int selectedSchematicIndex = -1;
    private int scrollOffset = 0;
    private static final int VISIBLE_ITEMS = 5;
    private static final int ITEM_HEIGHT = 18;

    // Transformation state
    private int selectedRotation = 0; // 0, 90, 180, 270

    // Workforce count state
    private static int selectedBotCount = 3;

    // Modal state
    private boolean showDespawnModal = false;

    // Inputs & Widgets
    private EditBox searchBox;
    private EditBox structureInput;
    private EditBox coordXBox;
    private EditBox coordYBox;
    private EditBox coordZBox;
    private static String savedCoordX = "";
    private static String savedCoordY = "";
    private static String savedCoordZ = "";
    private final List<Button> tabButtons = new ArrayList<>();
    private final List<Button> activePageWidgets = new ArrayList<>();
    private Button approveDespawnThisBtn;
    private Button approveDespawnAllBtn;
    private Button cancelDespawnBtn;

    // Window Layout
    private int winX, winY, winW, winH;
    private int listX, listY, listW, listH;

    public BuilderBotScreen(net.minecraft.world.entity.Entity bot) {
        super(Component.literal("Builder Bot Control Suite"));
        this.bot = bot;

        // Auto-switch all bots to creative mode
        ensureBotsInCreative();

        // Auto-detect the bot's position so the preview and build land exactly where the bot is standing!
        BlockPos botPos = null;
        if (bot != null) {
            botPos = bot.blockPosition();
        } else {
            botPos = findBotPosition();
        }

        if (botPos != null) {
            savedCoordX = String.valueOf(botPos.getX());
            savedCoordY = String.valueOf(botPos.getY());
            savedCoordZ = String.valueOf(botPos.getZ());
        } else if (savedCoordX.isEmpty() && Minecraft.getInstance().player != null) {
            BlockPos pPos = Minecraft.getInstance().player.blockPosition();
            savedCoordX = String.valueOf(pPos.getX());
            savedCoordY = String.valueOf(pPos.getY());
            savedCoordZ = String.valueOf(pPos.getZ());
        }
    }

    @Override
    protected void init() {
        if (coordXBox != null && !coordXBox.getValue().trim().isEmpty()) savedCoordX = coordXBox.getValue().trim();
        if (coordYBox != null && !coordYBox.getValue().trim().isEmpty()) savedCoordY = coordYBox.getValue().trim();
        if (coordZBox != null && !coordZBox.getValue().trim().isEmpty()) savedCoordZ = coordZBox.getValue().trim();

        this.clearWidgets();
        tabButtons.clear();
        activePageWidgets.clear();

        this.winW = 410;
        this.winH = 250;
        this.winX = (this.width - winW) / 2;
        this.winY = (this.height - winH) / 2;

        this.listX = winX + 14;
        this.listY = winY + 74;
        this.listW = 185;
        this.listH = VISIBLE_ITEMS * ITEM_HEIGHT;

        loadSchematics();

        // ── TOP TAB NAVIGATION BUTTONS ────────────────────────────────────────
        int tabW = (winW - 28) / 2;
        Button tab0Btn = Button.builder(
                Component.literal("📁 Schematics (NBT / Litematica)").withStyle(currentTab == 0 ? ChatFormatting.GOLD : ChatFormatting.GRAY),
                btn -> { currentTab = 0; this.init(); }
        ).bounds(winX + 14, winY + 28, tabW, 18).build();
        tabButtons.add(tab0Btn);
        this.addRenderableWidget(tab0Btn);

        Button tab1Btn = Button.builder(
                Component.literal("⚙ Swarm Fleet & Tools").withStyle(currentTab == 1 ? ChatFormatting.GOLD : ChatFormatting.GRAY),
                btn -> { currentTab = 1; this.init(); }
        ).bounds(winX + 14 + tabW, winY + 28, tabW, 18).build();
        tabButtons.add(tab1Btn);
        this.addRenderableWidget(tab1Btn);

        // ── BUILD ACTIVE TAB CONTENT ──────────────────────────────────────────
        switch (currentTab) {
            case 0 -> initSchematicsTab();
            case 1 -> initToolsTab();
        }

        // Bottom Bar: Close Button
        Button closeBtn = Button.builder(
                Component.literal("✖ Close Menu"),
                btn -> this.onClose()
        ).bounds(winX + (winW / 2) - 50, winY + winH - 24, 100, 18).build();
        addPageWidget(closeBtn);

        // ── DESPAWN CONFIRMATION MODAL BUTTONS ────────────────────────────────
        int modalW = 290;
        int modalH = 120;
        int modalX = (this.width - modalW) / 2;
        int modalY = (this.height - modalH) / 2;

        this.approveDespawnThisBtn = Button.builder(
                Component.literal("💨 Despawn This Bot").withStyle(ChatFormatting.RED),
                btn -> {
                    runCommand("builderbot despawn");
                    this.onClose();
                }
        ).bounds(modalX + 12, modalY + 62, (modalW / 2) - 16, 22).build();

        this.approveDespawnAllBtn = Button.builder(
                Component.literal("💥 Despawn ALL Bots").withStyle(ChatFormatting.DARK_RED, ChatFormatting.BOLD),
                btn -> {
                    runCommand("builderbot despawnall");
                    this.onClose();
                }
        ).bounds(modalX + (modalW / 2) + 4, modalY + 62, (modalW / 2) - 16, 22).build();

        this.cancelDespawnBtn = Button.builder(
                Component.literal("✖ CANCEL (Keep Bots)").withStyle(ChatFormatting.GREEN),
                btn -> setDespawnModalVisible(false)
        ).bounds(modalX + 12, modalY + 88, modalW - 24, 20).build();

        this.approveDespawnThisBtn.visible = false;
        this.approveDespawnAllBtn.visible = false;
        this.cancelDespawnBtn.visible = false;
        this.addRenderableWidget(this.approveDespawnThisBtn);
        this.addRenderableWidget(this.approveDespawnAllBtn);
        this.addRenderableWidget(this.cancelDespawnBtn);
    }

    private void addPageWidget(Button button) {
        activePageWidgets.add(button);
        this.addRenderableWidget(button);
    }

    // ── TAB 0: SCHEMATICS BROWSER & ROTATION ─────────────────────────────────
    private void initSchematicsTab() {
        this.searchBox = new EditBox(this.font, listX, winY + 52, listW - 40, 16, Component.literal("Search"));
        this.searchBox.setHint(Component.literal("🔍 Search...").withStyle(ChatFormatting.DARK_GRAY));
        this.searchBox.setMaxLength(64);
        this.searchBox.setResponder(this::filterSchematics);
        this.addRenderableWidget(searchBox);

        Button scrollUpBtn = Button.builder(Component.literal("▲"), btn -> scrollBy(-1))
                .bounds(listX + listW - 36, winY + 52, 16, 16).build();
        addPageWidget(scrollUpBtn);

        Button scrollDownBtn = Button.builder(Component.literal("▼"), btn -> scrollBy(1))
                .bounds(listX + listW - 18, winY + 52, 16, 16).build();
        addPageWidget(scrollDownBtn);

        // Action controls
        Button buildSelectedBtn = Button.builder(
                Component.literal("🏗 Build Selected").withStyle(ChatFormatting.GOLD, ChatFormatting.BOLD),
                btn -> onBuildSelectedSchematic()
        ).bounds(listX, listY + listH + 4, listW, 20).build();
        addPageWidget(buildSelectedBtn);

        Button openFolderBtn = Button.builder(
                Component.literal("📂 Folder"),
                btn -> SchematicManager.openSchematicsFolder()
        ).bounds(listX, listY + listH + 26, (listW / 2) - 2, 18).build();
        addPageWidget(openFolderBtn);

        Button refreshBtn = Button.builder(
                Component.literal("🔄 Refresh"),
                btn -> { loadSchematics(); this.scrollOffset = 0; }
        ).bounds(listX + (listW / 2) + 2, listY + listH + 26, (listW / 2) - 2, 18).build();
        addPageWidget(refreshBtn);

        // Right side: Hologram Preview, Rotation, Coordinates & Swarm Stepper
        int rightX = winX + 212;
        int rightY = winY + 52;
        int rightW = winW - 226;

        // Workforce Stepper
        initWorkforceStepper(rightX, rightY, rightW);

        // Rotation Selector: [ ⟲ 0° ] [ 90° ] [ 180° ] [ 270° ]
        int rotW = (rightW - 6) / 4;
        for (int i = 0; i < 4; i++) {
            final int deg = i * 90;
            Button rotBtn = Button.builder(
                    Component.literal(deg + "°").withStyle(selectedRotation == deg ? ChatFormatting.GOLD : ChatFormatting.WHITE),
                    btn -> { this.selectedRotation = deg; this.init(); }
            ).bounds(rightX + (i * (rotW + 2)), rightY + 22, rotW, 16).build();
            addPageWidget(rotBtn);
        }

        // Coordinates Inputs (X, Y, Z)
        int boxW = (rightW - 6) / 3;
        this.coordXBox = new EditBox(this.font, rightX, rightY + 42, boxW, 16, Component.literal("X"));
        this.coordXBox.setHint(Component.literal("X").withStyle(ChatFormatting.DARK_GRAY));
        this.coordXBox.setValue(savedCoordX);
        this.coordXBox.setResponder(val -> this.savedCoordX = val);
        this.addRenderableWidget(coordXBox);

        this.coordYBox = new EditBox(this.font, rightX + boxW + 3, rightY + 42, boxW, 16, Component.literal("Y"));
        this.coordYBox.setHint(Component.literal("Y").withStyle(ChatFormatting.DARK_GRAY));
        this.coordYBox.setValue(savedCoordY);
        this.coordYBox.setResponder(val -> this.savedCoordY = val);
        this.addRenderableWidget(coordYBox);

        this.coordZBox = new EditBox(this.font, rightX + (boxW * 2) + 6, rightY + 42, boxW, 16, Component.literal("Z"));
        this.coordZBox.setHint(Component.literal("Z").withStyle(ChatFormatting.DARK_GRAY));
        this.coordZBox.setValue(savedCoordZ);
        this.coordZBox.setResponder(val -> this.savedCoordZ = val);
        this.addRenderableWidget(coordZBox);

        // Quick Position Fill Buttons: [ 📍 My Pos ] [ 🤖 Bot Pos ]
        int posBtnW = (rightW - 4) / 2;
        Button myPosBtn = Button.builder(
                Component.literal("📍 My Pos").withStyle(ChatFormatting.AQUA),
                btn -> fillMyPosition()
        ).bounds(rightX, rightY + 62, posBtnW, 18).build();
        addPageWidget(myPosBtn);

        Button botPosBtn = Button.builder(
                Component.literal("🤖 Bot Pos").withStyle(ChatFormatting.YELLOW),
                btn -> fillBotPosition()
        ).bounds(rightX + posBtnW + 4, rightY + 62, posBtnW, 18).build();
        addPageWidget(botPosBtn);

        // 3D Block-by-Block Ghost Preview In World Button
        boolean hasGhost = com.example.builderbot.client.render.ClientGhostRenderer.hasActiveGhost();
        Component previewLabel = hasGhost
                ? Component.literal("❌ Clear 3D Ghost Blocks").withStyle(ChatFormatting.RED, ChatFormatting.BOLD)
                : Component.literal("🔮 Preview 3D Ghost Blocks").withStyle(ChatFormatting.AQUA, ChatFormatting.BOLD);

        Button previewBtn = Button.builder(
                previewLabel,
                btn -> onPreviewSchematic()
        ).bounds(rightX, rightY + 84, rightW, 18).build();
        addPageWidget(previewBtn);

        // Manual build input box
        this.structureInput = new EditBox(this.font, rightX, rightY + 106, rightW - 46, 18, Component.literal("ID"));
        this.structureInput.setHint(Component.literal("Structure ID...").withStyle(ChatFormatting.DARK_GRAY));
        this.addRenderableWidget(structureInput);

        Button manualBuildBtn = Button.builder(
                Component.literal("Build").withStyle(ChatFormatting.GREEN),
                btn -> onManualBuild()
        ).bounds(rightX + rightW - 42, rightY + 106, 42, 18).build();
        addPageWidget(manualBuildBtn);
    }

    private void fillMyPosition() {
        if (Minecraft.getInstance().player != null) {
            BlockPos pos = Minecraft.getInstance().player.blockPosition();
            this.savedCoordX = String.valueOf(pos.getX());
            this.savedCoordY = String.valueOf(pos.getY());
            this.savedCoordZ = String.valueOf(pos.getZ());
            if (coordXBox != null) coordXBox.setValue(this.savedCoordX);
            if (coordYBox != null) coordYBox.setValue(this.savedCoordY);
            if (coordZBox != null) coordZBox.setValue(this.savedCoordZ);
        }
    }

    public static BlockPos findBotPosition() {
        if (Minecraft.getInstance().level != null) {
            var botOpt = Minecraft.getInstance().level.players().stream()
                    .filter(p -> {
                        if (p == Minecraft.getInstance().player) return false;
                        String name = p.getName().getString().toLowerCase();
                        return name.contains("builderbot") || name.contains("builder");
                    })
                    .findFirst();
            if (botOpt.isPresent()) {
                return botOpt.get().blockPosition();
            }
        }
        return null;
    }

    private void fillBotPosition() {
        BlockPos pos = (this.bot != null) ? this.bot.blockPosition() : findBotPosition();
        if (pos != null) {
            this.savedCoordX = String.valueOf(pos.getX());
            this.savedCoordY = String.valueOf(pos.getY());
            this.savedCoordZ = String.valueOf(pos.getZ());
            if (coordXBox != null) coordXBox.setValue(this.savedCoordX);
            if (coordYBox != null) coordYBox.setValue(this.savedCoordY);
            if (coordZBox != null) coordZBox.setValue(this.savedCoordZ);
        } else {
            fillMyPosition();
        }
    }

    public BlockPos getTargetOrigin() {
        String xs = coordXBox != null ? coordXBox.getValue().trim() : savedCoordX.trim();
        String ys = coordYBox != null ? coordYBox.getValue().trim() : savedCoordY.trim();
        String zs = coordZBox != null ? coordZBox.getValue().trim() : savedCoordZ.trim();
        if (!xs.isEmpty() && !ys.isEmpty() && !zs.isEmpty()) {
            try {
                int x = Integer.parseInt(xs);
                int y = Integer.parseInt(ys);
                int z = Integer.parseInt(zs);
                return new BlockPos(x, y, z);
            } catch (NumberFormatException ignored) {}
        }
        BlockPos botPos = (this.bot != null) ? this.bot.blockPosition() : findBotPosition();
        if (botPos != null) {
            return botPos;
        }
        if (Minecraft.getInstance().player != null) {
            return Minecraft.getInstance().player.blockPosition();
        }
        return null;
    }

    private String buildCoordArgsString() {
        String x = coordXBox != null ? coordXBox.getValue().trim() : savedCoordX.trim();
        String y = coordYBox != null ? coordYBox.getValue().trim() : savedCoordY.trim();
        String z = coordZBox != null ? coordZBox.getValue().trim() : savedCoordZ.trim();
        if (x.isEmpty() || y.isEmpty() || z.isEmpty()) {
            return selectedRotation > 0 ? " " + selectedRotation : "";
        }
        return " " + x + " " + y + " " + z + " " + selectedRotation;
    }

    // ── TAB 1: SWARM CONTROLS, FLEET & UNDO ─────────────────────────────
    private void initToolsTab() {
        int leftX = winX + 14;
        int rightX = winX + 212;
        int btnW = 185;
        int startY = winY + 54;

        // Workforce Stepper
        initWorkforceStepper(leftX, startY, btnW);

        // Undo Last Build
        Button undoBtn = Button.builder(
                Component.literal("⏪ Undo Last Build").withStyle(ChatFormatting.YELLOW, ChatFormatting.BOLD),
                btn -> { runCommand("builderbot undo"); this.onClose(); }
        ).bounds(leftX, startY + 24, btnW, 22).build();
        addPageWidget(undoBtn);

        // Excavation & Terrain Clearing
        Button clearArea16 = Button.builder(
                Component.literal("🚜 Clear Area (16x16x16)"),
                btn -> { runCommand("builderbot cleararea 8 16"); this.onClose(); }
        ).bounds(leftX, startY + 50, btnW, 20).build();
        addPageWidget(clearArea16);

        Button clearArea32 = Button.builder(
                Component.literal("🚜 Mega Clear (32x32x24)"),
                btn -> { runCommand("builderbot cleararea 16 24"); this.onClose(); }
        ).bounds(leftX, startY + 74, btnW, 20).build();
        addPageWidget(clearArea32);

        // Flight Mode Toggle
        boolean isFlying = (bot instanceof BuilderBotEntity b) && b.isFlying();
        Button toggleFlyBtn = Button.builder(
                Component.literal(isFlying ? "🕊 Flight: ENABLED" : "🚶 Flight: DISABLED")
                        .withStyle(isFlying ? ChatFormatting.AQUA : ChatFormatting.GRAY),
                btn -> {
                    runCommand("builderbot fly");
                    boolean nowFlying = (bot instanceof BuilderBotEntity b) && !b.isFlying();
                    btn.setMessage(Component.literal(nowFlying ? "🕊 Flight: ENABLED" : "🚶 Flight: DISABLED")
                            .withStyle(nowFlying ? ChatFormatting.AQUA : ChatFormatting.GRAY));
                }
        ).bounds(rightX, startY, btnW, 20).build();
        addPageWidget(toggleFlyBtn);

        // Teleport
        Button tpBtn = Button.builder(
                Component.literal("📍 Teleport to Me").withStyle(ChatFormatting.YELLOW),
                btn -> { runCommand("builderbot tp"); this.onClose(); }
        ).bounds(rightX, startY + 24, btnW, 20).build();
        addPageWidget(tpBtn);

        // Stop Build
        Button stopBtn = Button.builder(
                Component.literal("⏹ Stop All Bots").withStyle(ChatFormatting.RED),
                btn -> { runCommand("builderbot stopall"); this.onClose(); }
        ).bounds(rightX, startY + 48, btnW, 20).build();
        addPageWidget(stopBtn);

        // Despawn Options
        Button despawnBtn = Button.builder(
                Component.literal("💨 Despawn Options...").withStyle(ChatFormatting.DARK_RED),
                btn -> setDespawnModalVisible(true)
        ).bounds(rightX, startY + 72, btnW, 22).build();
        addPageWidget(despawnBtn);
    }

    private void initWorkforceStepper(int x, int y, int width) {
        Button decBotBtn = Button.builder(
                Component.literal("-").withStyle(ChatFormatting.RED, ChatFormatting.BOLD),
                btn -> { if (selectedBotCount > 1) { selectedBotCount--; this.init(); } }
        ).bounds(x, y, 22, 18).build();
        addPageWidget(decBotBtn);

        String botDesc = selectedBotCount == 1 ? "1 Bot (Solo)" : selectedBotCount + " Bots (Swarm)";
        Button botCountDisplay = Button.builder(
                Component.literal("👥 " + botDesc).withStyle(ChatFormatting.YELLOW),
                btn -> {}
        ).bounds(x + 26, y, width - 52, 18).build();
        botCountDisplay.active = false;
        addPageWidget(botCountDisplay);

        Button incBotBtn = Button.builder(
                Component.literal("+").withStyle(ChatFormatting.GREEN, ChatFormatting.BOLD),
                btn -> { if (selectedBotCount < 10) { selectedBotCount++; this.init(); } }
        ).bounds(x + width - 22, y, 22, 18).build();
        addPageWidget(incBotBtn);
    }

    private void loadSchematics() {
        this.allSchematicFiles = SchematicManager.listSchematics();
        filterSchematics(searchBox != null ? searchBox.getValue() : "");
    }

    private void filterSchematics(String query) {
        String filter = query.toLowerCase().trim();
        if (filter.isEmpty()) {
            this.filteredSchematicFiles = new ArrayList<>(allSchematicFiles);
        } else {
            this.filteredSchematicFiles = allSchematicFiles.stream()
                    .filter(f -> f.getName().toLowerCase().contains(filter))
                    .toList();
        }

        if (selectedSchematicIndex >= filteredSchematicFiles.size()) {
            selectedSchematicIndex = filteredSchematicFiles.isEmpty() ? -1 : 0;
        }
        clampScroll();
    }

    private void scrollBy(int delta) {
        this.scrollOffset += delta;
        clampScroll();
    }

    private void clampScroll() {
        int maxScroll = Math.max(0, filteredSchematicFiles.size() - VISIBLE_ITEMS);
        if (scrollOffset > maxScroll) scrollOffset = maxScroll;
        if (scrollOffset < 0) scrollOffset = 0;
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
        if (!showDespawnModal && currentTab == 0) {
            if (mouseX >= listX && mouseX <= listX + listW && mouseY >= listY && mouseY <= listY + listH) {
                if (scrollY > 0) scrollBy(-1);
                else if (scrollY < 0) scrollBy(1);
                return true;
            }
        }
        return super.mouseScrolled(mouseX, mouseY, scrollX, scrollY);
    }

    @Override
    public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
        if (!showDespawnModal && currentTab == 0) {
            double mx = event.x();
            double my = event.y();

            if (mx >= listX && mx <= listX + listW && my >= listY && my <= listY + listH) {
                int rowClicked = (int) ((my - listY) / ITEM_HEIGHT);
                int clickedIndex = scrollOffset + rowClicked;
                if (clickedIndex >= 0 && clickedIndex < filteredSchematicFiles.size()) {
                    this.selectedSchematicIndex = clickedIndex;
                    if (doubleClick) {
                        onBuildSelectedSchematic();
                    }
                    return true;
                }
            }
        }
        return super.mouseClicked(event, doubleClick);
    }

    private void setDespawnModalVisible(boolean visible) {
        this.showDespawnModal = visible;
        this.approveDespawnThisBtn.visible = visible;
        this.approveDespawnAllBtn.visible = visible;
        this.cancelDespawnBtn.visible = visible;
        this.approveDespawnThisBtn.active = visible;
        this.approveDespawnAllBtn.active = visible;
        this.cancelDespawnBtn.active = visible;

        for (Button btn : activePageWidgets) btn.active = !visible;
        for (Button btn : tabButtons) btn.active = !visible;
        if (structureInput != null) structureInput.setEditable(!visible);
        if (searchBox != null) searchBox.setEditable(!visible);
    }

    public static void ensureBotsInCreative() {
        if (Minecraft.getInstance().player != null && Minecraft.getInstance().player.connection != null) {
            var conn = Minecraft.getInstance().player.connection;
            conn.sendCommand("gamemode creative BuilderBot");
            for (int i = 2; i <= 10; i++) {
                conn.sendCommand("gamemode creative BuilderBot_" + i);
            }
        }
    }

    private void sendOpPrepCommands(BlockPos origin) {
        if (Minecraft.getInstance().player != null && Minecraft.getInstance().player.connection != null) {
            var conn = Minecraft.getInstance().player.connection;
            // Ensure all swarm bots are strictly placed into creative mode
            ensureBotsInCreative();

            // Pre-teleport fleet to the exact chosen build origin
            if (origin != null) {
                conn.sendCommand("tp BuilderBot " + origin.getX() + " " + (origin.getY() + 1) + " " + origin.getZ());
                for (int i = 2; i <= selectedBotCount; i++) {
                    conn.sendCommand("tp BuilderBot_" + i + " " + origin.getX() + " " + (origin.getY() + 1) + " " + origin.getZ());
                }
            }
        }
    }

    private void onBuildSelectedSchematic() {
        com.example.builderbot.client.render.ClientGhostRenderer.clearGhostSchematic();
        if (selectedSchematicIndex >= 0 && selectedSchematicIndex < filteredSchematicFiles.size()) {
            File selected = filteredSchematicFiles.get(selectedSchematicIndex);
            BlockPos origin = getTargetOrigin();
            if (origin == null) {
                if (Minecraft.getInstance().player != null) {
                    Minecraft.getInstance().player.sendSystemMessage(
                        Component.literal("§c[BuilderBot] Please enter valid X, Y, Z coordinates before building!"));
                }
                return;
            }
            sendOpPrepCommands(origin);
            String coordArgs = buildCoordArgsString();
            runCommand("builderbot swarm " + selectedBotCount + " schematic " + selected.getName() + coordArgs);
            this.onClose();
        }
    }

    private void onPreviewSchematic() {
        if (com.example.builderbot.client.render.ClientGhostRenderer.hasActiveGhost()) {
            com.example.builderbot.client.render.ClientGhostRenderer.clearGhostSchematic();
            this.init();
            return;
        }

        if (selectedSchematicIndex >= 0 && selectedSchematicIndex < filteredSchematicFiles.size()) {
            File selected = filteredSchematicFiles.get(selectedSchematicIndex);
            BlockPos origin = getTargetOrigin();
            if (origin == null) {
                if (Minecraft.getInstance().player != null) {
                    Minecraft.getInstance().player.sendSystemMessage(
                        Component.literal("§c[BuilderBot] Please enter valid X, Y, Z coordinates before previewing!"));
                }
                return;
            }
            com.example.builderbot.client.render.ClientGhostRenderer.showGhostSchematic(
                    selected.getName(), origin, selectedRotation);
            this.onClose();
        }
    }

    private void onManualBuild() {
        com.example.builderbot.client.render.ClientGhostRenderer.clearGhostSchematic();
        String query = structureInput.getValue().trim();
        if (!query.isEmpty()) {
            BlockPos origin = getTargetOrigin();
            if (origin == null) {
                if (Minecraft.getInstance().player != null) {
                    Minecraft.getInstance().player.sendSystemMessage(
                        Component.literal("§c[BuilderBot] Please enter valid X, Y, Z coordinates before building!"));
                }
                return;
            }
            sendOpPrepCommands(origin);
            String coordArgs = buildCoordArgsString();
            if (query.endsWith(".litematic") || query.endsWith(".nbt")) {
                runCommand("builderbot swarm " + selectedBotCount + " schematic " + query + coordArgs);
            } else {
                runCommand("builderbot swarm " + selectedBotCount + " build " + query + coordArgs);
            }
            this.onClose();
        }
    }

    private void runCommand(String command) {
        if (Minecraft.getInstance().player != null && Minecraft.getInstance().player.connection != null) {
            var conn = Minecraft.getInstance().player.connection;
            boolean isIntegratedServer = Minecraft.getInstance().hasSingleplayerServer();

            if (isIntegratedServer) {
                // In singleplayer, the mod is installed on the internal server
                conn.sendCommand(command);
            } else {
                // On a multiplayer server (Aternos/Vanilla), translate directly into in-game bot chat commands
                if (command.equals("builderbot undo") || command.contains("undo")) {
                    conn.sendChat("!undo");
                } else if (command.equals("builderbot stop") || command.equals("builderbot stopall")) {
                    conn.sendChat("!stop");
                } else if (command.equals("builderbot tp")) {
                    conn.sendChat("!come");
                } else if (command.contains("schematic ")) {
                    String name = command.substring(command.indexOf("schematic ") + "schematic ".length()).trim();
                    if (command.contains("swarm ") && selectedBotCount > 1) {
                        conn.sendChat("!schematic swarm " + selectedBotCount + " " + name);
                    } else {
                        conn.sendChat("!schematic " + name);
                    }
                } else if (command.contains(" build ")) {
                    String name = command.substring(command.indexOf(" build ") + " build ".length()).trim();
                    if (command.contains("swarm ") && selectedBotCount > 1) {
                        conn.sendChat("!schematic swarm " + selectedBotCount + " " + name);
                    } else {
                        conn.sendChat("!schematic " + name);
                    }
                } else if (command.equals("builderbot fly")) {
                    conn.sendChat("!status");
                }
            }
        }
    }

    @Override
    public void extractRenderState(GuiGraphicsExtractor guiGraphics, int mouseX, int mouseY, float delta) {
        guiGraphics.fillGradient(0, 0, this.width, this.height, 0x90000000, 0xC0000000);

        // Window Frame
        guiGraphics.fill(winX - 1, winY - 1, winX + winW + 1, winY + winH + 1, 0xFFF59E0B);
        guiGraphics.fill(winX, winY, winX + winW, winY + winH, 0xFA111827);

        // Title Header
        guiGraphics.fill(winX, winY, winX + winW, winY + 24, 0xFA1E293B);
        guiGraphics.text(this.font, "🤖 BUILDER BOT CONTROL SUITE", winX + 12, winY + 8, 0xFFF59E0B);

        // Status Card
        BuildPlan plan = (bot instanceof BuilderBotEntity b) ? b.getCurrentPlan() : null;
        boolean isBuilding = plan != null && !plan.isEmpty();
        if (isBuilding) {
            String statusText = String.format("🔨 Building: %d/%d blocks (%d%%)",
                    plan.total() - plan.remaining(), plan.total(), plan.percentComplete());
            guiGraphics.text(this.font, statusText, winX + winW - 170, winY + 8, 0xFF38BDF8);
        } else {
            guiGraphics.text(this.font, "🟢 Ready", winX + winW - 65, winY + 8, 0xFF4ADE80);
        }

        // Tab 0 List Box Rendering
        if (currentTab == 0) {
            guiGraphics.fill(listX - 1, listY - 1, listX + listW + 1, listY + listH + 1, 0xFF334155);
            guiGraphics.fill(listX, listY, listX + listW, listY + listH, 0xFF020617);

            if (filteredSchematicFiles.isEmpty()) {
                guiGraphics.centeredText(this.font, "No schematics found", listX + (listW / 2), listY + 32, 0xFF64748B);
                guiGraphics.centeredText(this.font, "Click [Folder] to add", listX + (listW / 2), listY + 46, 0xFF475569);
            } else {
                int displayCount = Math.min(VISIBLE_ITEMS, filteredSchematicFiles.size() - scrollOffset);
                for (int i = 0; i < displayCount; i++) {
                    int itemIdx = scrollOffset + i;
                    File file = filteredSchematicFiles.get(itemIdx);
                    int itemTop = listY + (i * ITEM_HEIGHT);
                    boolean isSelected = (itemIdx == selectedSchematicIndex);
                    boolean isHovered = (mouseX >= listX && mouseX <= listX + listW - 6 && mouseY >= itemTop && mouseY < itemTop + ITEM_HEIGHT);

                    if (isSelected) {
                        guiGraphics.fill(listX + 1, itemTop + 1, listX + listW - 7, itemTop + ITEM_HEIGHT - 1, 0xFFB45309);
                    } else if (isHovered) {
                        guiGraphics.fill(listX + 1, itemTop + 1, listX + listW - 7, itemTop + ITEM_HEIGHT - 1, 0xFF1E293B);
                    }

                    String name = file.getName();
                    String icon = name.endsWith(".litematic") ? "📜 " : "📦 ";
                    if (name.length() > 22) name = name.substring(0, 19) + "...";
                    int textColor = isSelected ? 0xFFFFFFFF : (name.endsWith(".litematic") ? 0xFF38BDF8 : 0xFFA78BFA);
                    guiGraphics.text(this.font, icon + name, listX + 4, itemTop + 5, textColor);
                }

                // Scrollbar
                int scrollbarX = listX + listW - 5;
                guiGraphics.fill(scrollbarX, listY, scrollbarX + 4, listY + listH, 0xFF1E293B);
                int totalItems = filteredSchematicFiles.size();
                if (totalItems > VISIBLE_ITEMS) {
                    int thumbH = Math.max(12, (VISIBLE_ITEMS * listH) / totalItems);
                    int maxScroll = totalItems - VISIBLE_ITEMS;
                    int thumbY = listY + ((scrollOffset * (listH - thumbH)) / maxScroll);
                    guiGraphics.fill(scrollbarX, thumbY, scrollbarX + 4, thumbY + thumbH, 0xFFF59E0B);
                }
            }
        }

        super.extractRenderState(guiGraphics, mouseX, mouseY, delta);

        // Despawn Modal
        if (showDespawnModal) {
            guiGraphics.fill(0, 0, this.width, this.height, 0xDD000000);
            int modalW = 290;
            int modalH = 120;
            int modalX = (this.width - modalW) / 2;
            int modalY = (this.height - modalH) / 2;

            guiGraphics.fill(modalX - 1, modalY - 1, modalX + modalW + 1, modalY + modalH + 1, 0xFFEF4444);
            guiGraphics.fill(modalX, modalY, modalX + modalW, modalY + modalH, 0xFA18181B);

            guiGraphics.centeredText(this.font, "⚠ CONFIRM DESPAWN", modalX + (modalW / 2), modalY + 12, 0xFFEF4444);
            guiGraphics.centeredText(this.font, "Choose which bots to remove:", modalX + (modalW / 2), modalY + 30, 0xFFF4F4F5);
            guiGraphics.centeredText(this.font, "Active tasks will be cancelled.", modalX + (modalW / 2), modalY + 44, 0xFFA1A1AA);

            this.approveDespawnThisBtn.extractRenderState(guiGraphics, mouseX, mouseY, delta);
            this.approveDespawnAllBtn.extractRenderState(guiGraphics, mouseX, mouseY, delta);
            this.cancelDespawnBtn.extractRenderState(guiGraphics, mouseX, mouseY, delta);
        }
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }
}
