import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { Navbar } from '../components/Navbar';
import { useUiStore } from '../stores/uiStore';

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

function renderNavbar(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Navbar
        onOpenAiPlanner={() => undefined}
        onOpenAuth={() => undefined}
        bookmarkCount={0}
        savedItineraryCount={0}
        currentUser={null}
      />
      <LocationProbe />
    </MemoryRouter>
  );
}

beforeEach(() => {
  useUiStore.setState({ activeView: 'explore' });
});

describe('Navbar navigation', () => {
  it('highlights the tab matching the current URL', () => {
    renderNavbar('/explore');
    expect(screen.getByRole('button', { name: /explore places/i })).toHaveClass('active');
    expect(screen.getByRole('button', { name: /saved places/i })).not.toHaveClass('active');
  });

  it('switches the URL and active styling when a desktop tab is clicked', async () => {
    const user = userEvent.setup();
    renderNavbar('/explore');

    await user.click(screen.getByRole('button', { name: /saved places/i }));

    expect(screen.getByTestId('location')).toHaveTextContent('/bookmarks');
    expect(screen.getByRole('button', { name: /saved places/i })).toHaveClass('active');
    expect(screen.getByRole('button', { name: /explore places/i })).not.toHaveClass('active');
  });

  it('switches the active tab via the mobile bottom bar', async () => {
    const user = userEvent.setup();
    renderNavbar('/explore');

    await user.click(screen.getByRole('button', { name: /^trips$/i }));

    expect(screen.getByTestId('location')).toHaveTextContent('/itineraries');
    expect(screen.getByRole('button', { name: /^trips$/i })).toHaveClass('active');
    expect(screen.getByRole('button', { name: /explore places/i })).not.toHaveClass('active');
  });

  it('shows the profile tab as active when on the profile route', () => {
    renderNavbar('/profile');
    const profileTabs = screen.getAllByRole('button', { name: /profile/i });
    expect(profileTabs.length).toBeGreaterThan(0);
    profileTabs.forEach((tab) => expect(tab).toHaveClass('active'));
    expect(screen.getByRole('button', { name: /explore places/i })).not.toHaveClass('active');
  });

  it('navigates the brand logo back to /explore', async () => {
    const user = userEvent.setup();
    const { container } = renderNavbar('/bookmarks');

    const brandLogo = container.querySelector('.brand-logo') as HTMLElement;
    expect(brandLogo).not.toBeNull();
    await user.click(brandLogo);

    expect(screen.getByTestId('location')).toHaveTextContent('/explore');
    expect(screen.getByRole('button', { name: /explore places/i })).toHaveClass('active');
  });

  it('navigates to /trips from the Trip Workspaces desktop tab', async () => {
    const user = userEvent.setup();
    renderNavbar('/explore');

    await user.click(screen.getByRole('button', { name: /trip workspaces/i }));

    expect(screen.getByTestId('location')).toHaveTextContent('/trips');
  });

  it('navigates to /trips from the Workspaces mobile tab', async () => {
    const user = userEvent.setup();
    renderNavbar('/explore');

    await user.click(screen.getByRole('button', { name: /^workspaces$/i }));

    expect(screen.getByTestId('location')).toHaveTextContent('/trips');
  });

  it('navigates to /profile from the user avatar when signed in', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/explore']}>
        <Navbar
          onOpenAiPlanner={() => undefined}
          onOpenAuth={() => undefined}
          bookmarkCount={0}
          savedItineraryCount={0}
          currentUser={{
            id: 'u1',
            username: 'Traveler',
            email: 'traveler@example.com',
            avatarUrl: 'https://example.com/avatar.png',
            provider: 'google',
            profile: { travelStyles: [], interests: [] },
          }}
        />
        <LocationProbe />
      </MemoryRouter>
    );

    await user.click(screen.getByTitle('Open my profile'));

    expect(screen.getByTestId('location')).toHaveTextContent('/profile');
  });
});
