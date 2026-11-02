<x-layout-simple>
    <x-auth.shell title="AniCo" description="Správa aplikací">
        @if (session('error'))
            <x-auth.alert type="error">{{ session('error') }}</x-auth.alert>
        @endif
        @if ($errors->any())
            <x-auth.alert type="error">{{ $errors->first() }}</x-auth.alert>
        @endif
        @if (request()->query('recovery') === '1')
            <form action="/login" method="POST" class="flex flex-col gap-4">
                @csrf
                <x-forms.input type="email" name="email" label="E-mail" required />
                <x-forms.input type="password" name="password" label="Heslo" required />
                <x-forms.button type="submit">Nouzové přihlášení přes SSH tunel</x-forms.button>
            </form>
        @else
            <x-forms.button type="button" onclick="document.location.href='/auth/github/redirect'">
                Přihlásit přes GitHub
            </x-forms.button>
            @if (!$errors->any() && !session('error'))
                <script>window.location.replace('/auth/github/redirect');</script>
            @endif
        @endif
    </x-auth.shell>
</x-layout-simple>
