A few modifications/updates to make to our frontend:

1. The top header nav bar should have the same height as the CORELLIA section in the left nav bar i.e. should be aligned.
2. The profile top right of the nav bar should be clickable with a dropdown of the usual options (profile, settings, signout). Signout should sign out the user.
3. The Corellia 'logo' top left should look more like a distinct logo - perhaps all-caps, a unique font weight and spacing applied to make it look more impactful like a real "Logo". Remove the ">" before it.
4. When I delete an Agent Instance, it's currently struck out and marked as "destroyed", which is fine. However: (A) there should be a simple filter on the FLEET page table allowing me to show only running ones i.e. hide destroyed ones and (B) on the DASHBOARD page, under the "Fleet Total" it should not include destroyed ones in its count.

If all clear, go ahead and implement the above improvements.

Once done, outline your detailed implementation notes into a new completion md file in docs/completions, so we keep track of what was done where/how/why.