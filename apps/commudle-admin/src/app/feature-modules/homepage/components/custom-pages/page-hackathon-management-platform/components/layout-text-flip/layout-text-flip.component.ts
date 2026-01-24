import { Component, Input, OnInit, OnDestroy, signal, HostBinding } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'commudle-layout-text-flip',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="prefix-text">{{ text }}</span>

    <span class="flip-container">
      @for (word of words; track word; let i = $index) {
      <span class="flip-word" [class.active]="i === currentIndex()" [class.exit]="i === previousIndex()">
        {{ word }}
      </span>
      }
    </span>

    @if (suffix) {
    <span class="suffix-text">{{ suffix }}</span>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }

      /* Dark theme (default) */
      .prefix-text,
      .suffix-text {
        font-size: 1rem;
        font-weight: 700;
        letter-spacing: -0.025em;
        color: #a3a3a3;
        filter: drop-shadow(0 10px 8px rgb(0 0 0 / 0.04)) drop-shadow(0 4px 3px rgb(0 0 0 / 0.1));
      }

      @media (min-width: 768px) {
        .prefix-text,
        .suffix-text {
          font-size: 2.25rem;
        }
      }

      .flip-container {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        border-radius: 0.25rem;
        border: 1px solid #404040;
        background-color: rgba(38, 38, 38, 0.5);
        padding: 0.25rem 0.5rem;
        font-family: sans-serif;
        font-size: 1rem;
        font-weight: 700;
        letter-spacing: -0.025em;
        color: #d4d4d4;
        box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05), 0 0 0 1px rgba(255, 255, 255, 0.1);
        filter: drop-shadow(0 10px 8px rgb(0 0 0 / 0.04)) drop-shadow(0 4px 3px rgb(0 0 0 / 0.1));
        min-width: 80px;
        height: 36px;
      }

      @media (min-width: 768px) {
        .flip-container {
          font-size: 2.25rem;
          min-width: 160px;
          height: 68px;
          padding: 0.5rem 1rem;
          border-radius: 0.375rem;
        }
      }

      .flip-word {
        position: absolute;
        display: inline-block;
        white-space: nowrap;
        opacity: 0;
        transform: translateY(-40px);
        filter: blur(10px);
        transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.5s cubic-bezier(0.4, 0, 0.2, 1),
          filter 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        pointer-events: none;
      }

      .flip-word.active {
        position: relative;
        opacity: 1;
        transform: translateY(0);
        filter: blur(0);
        pointer-events: auto;
      }

      .flip-word.exit {
        position: absolute;
        opacity: 0;
        transform: translateY(50px);
        filter: blur(10px);
      }

      /* Light theme styles */
      :host.light-theme .prefix-text,
      :host.light-theme .suffix-text {
        color: #64748b;
      }

      :host.light-theme .flip-container {
        border: 1px solid #e2e8f0;
        background-color: rgba(255, 255, 255, 0.9);
        color: #3b82f6;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(59, 130, 246, 0.2);
      }
    `,
  ],
})
export class LayoutTextFlipComponent implements OnInit, OnDestroy {
  @Input() text = 'Build Amazing';
  @Input() words: string[] = ['Landing Pages', 'Component Blocks', 'Page Sections'];
  @Input() suffix?: string;
  @Input() duration = 3000;
  @Input() theme: 'light' | 'dark' = 'dark';

  @HostBinding('class.light-theme') get isLightTheme() {
    return this.theme === 'light';
  }

  currentIndex = signal(0);
  previousIndex = signal(-1);

  private intervalId: ReturnType<typeof setInterval> | null = null;

  ngOnInit() {
    this.intervalId = setInterval(() => {
      this.previousIndex.set(this.currentIndex());
      this.currentIndex.set((this.currentIndex() + 1) % this.words.length);

      // Reset previousIndex after animation completes
      setTimeout(() => {
        this.previousIndex.set(-1);
      }, 500);
    }, this.duration);
  }

  ngOnDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }
}
