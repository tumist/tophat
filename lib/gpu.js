'use strict';

const {Clutter, Gio, GLib, GObject, GTop, St} = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Monitor = Me.imports.lib.monitor;
const Config = Me.imports.lib.config;
const _ = Config.Domain.gettext;

const ByteArray = imports.byteArray;

var GpuMonitor = GObject.registerClass(
    class GpuMonitor extends Monitor.TopHatMonitor {
        _init(configHandler) {
            super._init(`${Me.metadata.name} GPU Monitor`);

            let gicon = Gio.icon_new_for_string(`${Me.path}/icons/gpu-icon-symbolic.svg`);
            this.icon = new St.Icon({gicon, style_class: 'system-status-icon tophat-panel-icon'});
            this.add_child(this.icon);

            this.usage = new St.Label({
                text: '',
                style_class: 'tophat-panel-usage',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.add_child(this.usage);

            configHandler.settings.bind('meter-fg-color', this, 'meter-fg-color', Gio.SettingsBindFlags.GET);
            configHandler.settings.bind('meter-bar-width', this, 'meter-bar-width', Gio.SettingsBindFlags.GET);
            configHandler.settings.bind('show-animations', this, 'show-animation', Gio.SettingsBindFlags.GET);

            this.history = new Array(0);
            this.refreshTimer = 0;

            let id = this.connect('notify::visible', () => {
                if (this.visible) {
                    this._startTimers();
                } else {
                    this._stopTimers();
                }
            });
            this._signals.push(id);

            this._buildMeter();
            this._buildMenu();
            this._startTimers();
        }

        _buildMeter() {
            this.setMeter(new Monitor.Meter(2, this.meter_bar_width));
        }

        _buildMenu() {
            let label = new St.Label({text: _('GPU usage'), style_class: 'menu-header'});
            this.addMenuRow(label, 0, 2, 1);

            label = new St.Label({text: _('GPU utilization:'), style_class: 'menu-label menu-section-end'});
            this.addMenuRow(label, 0, 1, 1);
            this.menuGpuUsage = new St.Label({text: '0%', style_class: 'menu-value menu-section-end'});
            this.addMenuRow(this.menuGpuUsage, 1, 1, 1);

            this.historyChart = new St.DrawingArea({style_class: 'chart'});
            this.historyChart.connect('repaint', () => this._repaintHistory());
            this.addMenuRow(this.historyChart, 0, 2, 1);

            this.buildMenuButtons();
        }

        _startTimers() {
            // Clear the history chart
            this.history = [];
    
            if (this.refreshTimer === 0) {
                this.refreshTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Config.UPDATE_INTERVAL_CPU, () => this._refreshCharts());
            }
        }

        _stopTimers() {
            if (this.refreshTimer !== 0) {
                GLib.source_remove(this.refreshTimer);
                this.refreshTimer = 0;
            }
        }

        refresh() {
            this._refreshCharts();
        }

        _refreshCharts() {
            let currentGpuUsage = 0;
            let currentGpuMemUsage = 0;
            try {
                const inputFile = Gio.File.new_for_path('/sys/class/drm/card0/device/gpu_busy_percent');
                const [, content] = inputFile.load_contents(null);
                const contentStr = ByteArray.toString(content).trim();
        
                currentGpuUsage = contentStr / 100;
            } catch (e) {
                logError(e);
                return;
            }
            try {
                const inputFile = Gio.File.new_for_path('/sys/class/drm/card0/device/mem_busy_percent');
                const [, content] = inputFile.load_contents(null);
                const contentStr = ByteArray.toString(content).trim();
        
                currentGpuMemUsage = contentStr / 100;
            } catch (e) {
                logError(e);
                return;
            }
            //log(currentGpuUsage);   
            this.meter.setUsage([currentGpuUsage * 100, currentGpuMemUsage * 100]);
            this.usage.text = `${(currentGpuUsage * 100).toFixed(0)}%`;
            this.menuGpuUsage.text = `${currentGpuUsage * 100}%`;

            while (this.history.length >= Config.HISTORY_MAX_SIZE) {
                this.history.shift();
            }
            this.history.push(currentGpuUsage);

            this.historyChart.queue_repaint();

            return true;
        }

        _repaintHistory() {
            let [width, height] = this.historyChart.get_surface_size();
            let pointSpacing = width / (Config.HISTORY_MAX_SIZE - 1);
            let xStart = (Config.HISTORY_MAX_SIZE - this.history.length) * pointSpacing;
            let ctx = this.historyChart.get_context();
            var fg, bg;
            [, fg] = Clutter.Color.from_string(this.meter_fg_color);
            [, bg] = Clutter.Color.from_string(Config.METER_BG_COLOR);
    
            Clutter.cairo_set_source_color(ctx, bg);
            ctx.rectangle(0, 0, width, height);
            ctx.fill();
    
            Clutter.cairo_set_source_color(ctx, fg);
            ctx.moveTo(xStart, height);
            for (let i = 0; i < this.history.length; i++) {
                let pointHeight = Math.ceil(this.history[i] * height);
                let x = xStart + pointSpacing * i;
                let y = height - pointHeight;
                ctx.lineTo(x, y);
            }
            ctx.lineTo(xStart + (this.history.length - 1) * pointSpacing, height);
            ctx.closePath();
            ctx.fill();
    
            ctx.$dispose();
        }

        destroy() {
            this._stopTimers();
            super.destroy();
        }
    }
);