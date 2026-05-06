import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal, ModalStackProvider } from '../src/components/Modal';

const wrap = (ui: React.ReactNode) => (
  <ModalStackProvider>{ui}</ModalStackProvider>
);

describe('Modal', () => {
  it('renders nothing when isOpen is false', () => {
    render(wrap(<Modal isOpen={false} onClose={() => {}}>hello</Modal>));
    expect(screen.queryByText('hello')).not.toBeInTheDocument();
  });

  it('renders into a portal when isOpen is true', () => {
    render(wrap(<Modal isOpen onClose={() => {}}>hello</Modal>));
    expect(screen.getByText('hello')).toBeInTheDocument();
    // Has the dialog ARIA role
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Escape closes the modal', () => {
    const onClose = vi.fn();
    render(wrap(<Modal isOpen onClose={onClose}>x</Modal>));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape only closes the TOP modal in the stack', () => {
    const closeA = vi.fn();
    const closeB = vi.fn();
    render(wrap(
      <>
        <Modal isOpen onClose={closeA}>A</Modal>
        <Modal isOpen onClose={closeB}>B</Modal>
      </>
    ));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(closeA).not.toHaveBeenCalled();
  });

  it('respects closeOnEscape=false', () => {
    const onClose = vi.fn();
    render(wrap(<Modal isOpen onClose={onClose} closeOnEscape={false}>x</Modal>));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('backdrop click closes by default', () => {
    const onClose = vi.fn();
    render(wrap(<Modal isOpen onClose={onClose}>inside</Modal>));
    const backdrop = screen.getByRole('dialog');
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking inner content does NOT close', () => {
    const onClose = vi.fn();
    render(wrap(
      <Modal isOpen onClose={onClose} contentClassName="content">
        <button>inner</button>
      </Modal>
    ));
    fireEvent.mouseDown(screen.getByText('inner'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('respects closeOnBackdrop=false', () => {
    const onClose = vi.fn();
    render(wrap(<Modal isOpen onClose={onClose} closeOnBackdrop={false}>x</Modal>));
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stacked modals get increasing z-index', () => {
    render(wrap(
      <>
        <Modal isOpen onClose={() => {}}>A</Modal>
        <Modal isOpen onClose={() => {}}>B</Modal>
      </>
    ));
    const dialogs = screen.getAllByRole('dialog');
    const zA = parseInt(getComputedStyle(dialogs[0]).zIndex || '0', 10);
    const zB = parseInt(getComputedStyle(dialogs[1]).zIndex || '0', 10);
    expect(zB).toBeGreaterThan(zA);
  });

  it('throws a clear error when used outside ModalStackProvider', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(<Modal isOpen onClose={() => {}}>x</Modal>)
    ).toThrow(/ModalStackProvider/);
    errSpy.mockRestore();
  });

  it('after unmount, escape from a sibling modal still works', () => {
    const closeB = vi.fn();
    const Toggle: React.FC = () => {
      const [aOpen, setAOpen] = useState(true);
      return (
        <>
          <button onClick={() => setAOpen(false)}>close A</button>
          <Modal isOpen={aOpen} onClose={() => setAOpen(false)}>A</Modal>
          <Modal isOpen onClose={closeB}>B</Modal>
        </>
      );
    };
    render(wrap(<Toggle />));
    // Close A (B remains)
    fireEvent.click(screen.getByText('close A'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeB).toHaveBeenCalledTimes(1);
  });
});
